import { runChaosGame, type ChaosGameResult } from "../fractal/chaos-game";
import { buildColors } from "../fractal/color";
import {
  DEFAULT_GAMMA_THRESHOLD,
  tonemapFlame,
  viewFlameHistogram,
} from "../fractal/flame";
import type { FlameWorkerCommand, FlameWorkerEvent } from "./flame-worker-core";
import type { SharedFrameBuffers } from "./flame-worker-core";
import type { VoxelWorkerCommand, VoxelWorkerEvent } from "./voxel-worker-core";
import { glowExposure } from "./exposure";
import { defaultFinalTransform, presetTransforms } from "../fractal/presets";
import { randomSystem } from "../fractal/random-system";
import {
  BOOT_CAMERA_POSITION,
  boundsCenter,
  fitRadius,
  OrbitCamera,
  smoothstep,
} from "./orbit";
import { FractalScene } from "./scene";
import { attachInteractions } from "./interactions";
import { registerServiceWorker } from "./register-sw";
import { Ui } from "./ui";
import {
  addTransform,
  initialState,
  removeTransform,
  selectTransform,
  setAutoUpdate,
  setColorMode,
  setFinalTransform,
  setFlameActive,
  setFlameEstimatorCurve,
  setFlameEstimatorMinimumRadius,
  setFlameEstimatorRadius,
  setFlameExposure,
  setFlameGamma,
  setFlameIterations,
  setFlamePaletteId,
  setFlameSupersample,
  setFlameVibrancy,
  setGlowBrightness,
  setNumPoints,
  setPanelOpen,
  setPointSize,
  setRenderStyle,
  setShowGuides,
  setSolidActive,
  setSolidAmbient,
  setSolidIterations,
  setSolidLightAzimuth,
  setSolidLightElevation,
  setSolidPaletteId,
  setSolidResolution,
  setSolidThreshold,
  setSymmetryAxis,
  setSymmetryOrder,
  setTransforms,
  updateTransform,
} from "./state";
import type { AppState } from "./state";
import { fromSnapshot, loadScene, saveScene, toSnapshot } from "./persist";
import { MOBILE_BREAKPOINT } from "./constants";
import type { Vec3 } from "../fractal/types";

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

  // The most recent chaos-game run, cached so a color-mode change can recolor
  // the existing cloud (see `recolor`) instead of re-rolling the RNG and drawing
  // a brand-new random sample of the attractor.
  let lastResult: ChaosGameResult | null = null;

  // Re-run the chaos game: the only path that touches the RNG and changes point
  // positions. Use this for geometry edits, add/remove, presets, and explicit
  // regenerate — never for a mere palette change.
  function regenerate(): void {
    lastResult = runChaosGame(
      state.transforms,
      state.numPoints,
      Math.random,
      state.finalTransform ?? null,
      state.symmetry,
    );
    const colors = buildColors(lastResult, state.transforms, state.colorMode);
    scene.setPoints(lastResult.positions, colors);
    ui.setPointCount(lastResult.count);
  }

  // Rebuild only the color buffer over the cached cloud and push it to the
  // scene. Leaves positions (and thus the RNG) untouched, so switching color
  // mode recolors the same shape instantly. No-op before the first generation.
  function recolor(): void {
    if (!lastResult) return;
    const colors = buildColors(lastResult, state.transforms, state.colorMode);
    scene.setColors(colors);
  }

  // Auto-fit the camera to a freshly-generated attractor (fr-0b8): a
  // whole-system replacement (preset load / Surprise Me) can leave the
  // previous camera pointed at empty space or buried inside the new cloud,
  // so glide target/radius to frame it instead of leaving first impressions
  // to luck. theta/phi are left untouched — only the distance and the point
  // being orbited move, so the fractal swaps in place and the camera glides
  // to meet it. Never triggered by Regenerate or a geometry edit (those
  // would fight the user's own framing) — call sites are onPreset/onSurprise
  // below, right after `applyEdit`'s synchronous regenerate lands a fresh
  // `lastResult`.
  interface CameraTween {
    startMs: number;
    fromRadius: number;
    toRadius: number;
    fromTarget: Vec3;
    toTarget: Vec3;
  }
  const CAMERA_TWEEN_MS = 600;
  let cameraTween: CameraTween | null = null;

  function fitCameraToAttractor(): void {
    if (!lastResult) return;
    const toTarget = boundsCenter(lastResult.bounds);
    const toRadius = fitRadius(
      lastResult.bounds,
      (scene.camera.fov * Math.PI) / 180,
      scene.camera.aspect,
    );
    const reducedMotion =
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
    if (reducedMotion) {
      orbit.target[0] = toTarget[0];
      orbit.target[1] = toTarget[1];
      orbit.target[2] = toTarget[2];
      orbit.spherical.radius = toRadius;
      cameraTween = null;
      return;
    }
    cameraTween = {
      startMs: performance.now(),
      fromRadius: orbit.spherical.radius,
      toRadius,
      fromTarget: [orbit.target[0], orbit.target[1], orbit.target[2]],
      toTarget,
    };
  }

  // Advance the in-flight camera tween, if any; called from animate() before
  // applyCamera so the frame it takes effect on is the one that gets drawn.
  function advanceCameraTween(): void {
    if (!cameraTween) return;
    const { startMs, fromRadius, toRadius, fromTarget, toTarget } = cameraTween;
    const t = smoothstep((performance.now() - startMs) / CAMERA_TWEEN_MS);
    orbit.spherical.radius = fromRadius + (toRadius - fromRadius) * t;
    orbit.target[0] = fromTarget[0] + (toTarget[0] - fromTarget[0]) * t;
    orbit.target[1] = fromTarget[1] + (toTarget[1] - fromTarget[1]) * t;
    orbit.target[2] = fromTarget[2] + (toTarget[2] - fromTarget[2]) * t;
    if (t >= 1) cameraTween = null;
  }

  // Grabbing the camera mid-glide should feel like a normal orbit, not a
  // fight with the animation — cancel outright on the next user gesture.
  // Capture phase so this runs before interactions.ts's own (bubble-phase)
  // listeners on the same canvas. COORDINATION: the idle-turntable bead
  // (fr-1yn, not yet implemented) needs an identical "last canvas input"
  // listener — if it lands, merge into one shared helper here instead of two
  // separate listener sets.
  function cancelCameraTween(): void {
    cameraTween = null;
  }
  const cancelTweenOptions: AddEventListenerOptions = {
    capture: true,
    passive: true,
  };
  scene.canvas.addEventListener(
    "pointerdown",
    cancelCameraTween,
    cancelTweenOptions,
  );
  scene.canvas.addEventListener("wheel", cancelCameraTween, cancelTweenOptions);
  scene.canvas.addEventListener(
    "touchstart",
    cancelCameraTween,
    cancelTweenOptions,
  );

  // Flame render session (fr-o7s/fr-ucs/fr-73y): a Web Worker owns the
  // supersampled accumulation, the OOM guard, the throttled downsample, and
  // (in transfer mode) the tone-map (see flame-worker-core.ts) — this is
  // thin glue that spins one up per render and forwards UI events as
  // messages. When the page is cross-origin isolated (fr-96i: natively in
  // dev via vite's server headers; in production via the COOP/COEP-injecting
  // service worker in sw/sw.ts, since GitHub Pages cannot send those headers
  // itself), the render upgrades to a SharedArrayBuffer transport: the
  // worker downsamples into shared display-resolution buckets and THIS
  // thread tone-maps a live view of them (see presentSharedFrame), so
  // exposure/gamma/vibrancy changes land instantly with no worker round
  // trip and nothing per-tick crosses but a few scalars. Without isolation
  // it falls back to fr-73y's postMessage transfer of a tone-mapped image.
  // Either way the big oversampled accumulator never leaves the worker.
  let flameWorker: Worker | null = null;
  // True once the CURRENT session's first "progress" image has arrived.
  // Spinning up a worker (and the round trip to its first accumulate +
  // downsample + tone-map) takes real time, unlike fr-o7s's synchronous
  // first stepFlame call — animate() uses this to keep showing the frozen
  // explorer view for that gap instead of a flash of the flame canvas's
  // stale contents (blank on a first-ever render, or the PREVIOUS render's
  // image on a repeat one, since neither enter nor exit clears it).
  let flameHasImage = false;

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

  function postFlame(command: FlameWorkerCommand): void {
    flameWorker?.postMessage(command);
  }

  function handleFlameEvent(event: FlameWorkerEvent): void {
    switch (event.type) {
      case "progress":
        scene.setFlameImage(event.image, event.width, event.height);
        ui.setFlameProgress(event.iterationsDone, event.iterationsBudget);
        flameHasImage = true;
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
          flameHasImage = true;
        }
        break;
      case "supersampleNote":
        ui.setFlameSupersampleNote(event.effective, event.requested);
        break;
      case "estimating":
        ui.setFlameEstimating();
        break;
      case "error":
        console.error(
          "Flame render failed to accumulate; returning to explorer.",
          event.message,
        );
        exitFlameMode();
        break;
    }
  }

  // Freeze the current camera and start converging a flame render of it in a
  // fresh worker. Called only from the Render button — never automatically —
  // so the explorer stays the default, always-interactive experience.
  function enterFlameMode(): void {
    flameWorker?.terminate(); // defensive: guard against a theoretical double-entry leaking a worker.
    const { width, height } = scene.flameRenderSize();
    const projection = scene.flameProjectionMatrix();
    ui.setFlameSupersampleNote(null); // clear any note from a previous render before the fresh worker reports its own.
    ui.setFlameProgress(0, state.flame.iterations); // reset from a previous render's "100%" rather than leaving it stale until the first progress event.
    flameHasImage = false; // keep showing the frozen explorer (see animate()) until this session's first image arrives.
    flameShared = tryCreateFlameSharedSession(width, height);
    console.info(
      flameShared
        ? "Flame render: SharedArrayBuffer transport (cross-origin isolated)."
        : "Flame render: postMessage-transfer transport.",
    );

    flameWorker = new Worker(new URL("./flame-worker.ts", import.meta.url), {
      type: "module",
    });
    flameWorker.onmessage = (e: MessageEvent<FlameWorkerEvent>) =>
      handleFlameEvent(e.data);
    flameWorker.onerror = (e) => {
      console.error("Flame worker crashed; returning to explorer.", e);
      exitFlameMode();
    };

    postFlame({
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
    });

    state = setFlameActive(state, true);
    refreshUi();
  }

  // Discard the in-progress render and return to the live explorer, exactly
  // as it was left (the camera/orbit was never touched while rendering). The
  // worker is terminated outright rather than asked to wind down: an
  // in-flight accumulate chunk can't be interrupted mid-call anyway (a
  // worker is single-threaded JS too), and the next Render click spins up a
  // fresh worker rather than trying to reuse this one.
  function exitFlameMode(): void {
    flameWorker?.terminate();
    flameWorker = null;
    flameShared = null; // drop our half of the shared buffers; with the worker's half gone too, the SABs are collectable.
    ui.setFlameSupersampleNote(null);
    flameHasImage = false; // tidy up so a stray flame frame can't leak into a future session's gap.
    state = setFlameActive(state, false);
    refreshUi();
  }

  // Solid render session (fr-v4f): mirrors the flame session above exactly,
  // except the accumulated volume is world-space, so — unlike the frozen
  // flame view — the camera stays LIVE while it converges (see animate()).
  let solidWorker: Worker | null = null;
  // True once the CURRENT session's first "grid" event has arrived; like
  // flameHasImage, keeps the live explorer showing during the worker's
  // startup gap instead of flashing an empty/stale volume.
  let solidHasTexture = false;

  function postVoxel(command: VoxelWorkerCommand): void {
    solidWorker?.postMessage(command);
  }

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
        solidHasTexture = true;
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
        exitSolidMode();
        break;
    }
  }

  // Start accumulating a density volume of the current system in a fresh
  // worker. Unlike enterFlameMode this does NOT freeze the camera: the grid
  // is world-space, so the live orbit keeps working over it (see animate()).
  // Also drops any transform selection, since the lens has no guide box in
  // this mode and pointer gestures should orbit the camera instead of
  // dragging one that's no longer shown.
  function enterSolidMode(): void {
    solidWorker?.terminate(); // defensive: guard against a theoretical double-entry leaking a worker.
    ui.setSolidResolutionNote(null); // clear any note from a previous render before the fresh worker reports its own.
    ui.setSolidProgress(0, state.solid.iterations); // reset from a previous render's "100%" rather than leaving it stale until the first grid event.
    solidHasTexture = false; // keep showing the live explorer (see animate()) until this session's first grid arrives.

    solidWorker = new Worker(new URL("./voxel-worker.ts", import.meta.url), {
      type: "module",
    });
    solidWorker.onmessage = (e: MessageEvent<VoxelWorkerEvent>) =>
      handleSolidEvent(e.data);
    solidWorker.onerror = (e) => {
      console.error("Solid worker crashed; returning to explorer.", e);
      exitSolidMode();
    };

    postVoxel({
      type: "start",
      transforms: state.transforms,
      finalTransform: state.finalTransform ?? null,
      resolution: state.solid.resolution,
      // The explorer's Color Mode carries into the voxel colors (fr-c1d);
      // entering the mode snapshots it, exactly like the transform set.
      colorMode: state.colorMode,
      paletteId: state.solid.paletteId,
      iterationsBudget: state.solid.iterations,
      // A worker needs an explicit numeric seed — a live Rng (like
      // Math.random) can't cross postMessage — which as a side effect makes
      // a render a reproducible pure function of its inputs.
      seed: Math.floor(Math.random() * 0xffffffff),
      order: state.symmetry.order,
      axis: state.symmetry.axis,
    });

    state = selectTransform(state, null);
    state = setSolidActive(state, true);
    refreshGuides();
    refreshUi();
  }

  // Discard the in-progress accumulation and return to the live explorer.
  // Like exitFlameMode, terminates outright rather than asking the worker to
  // wind down — the next Render click spins up a fresh one regardless.
  function exitSolidMode(): void {
    solidWorker?.terminate();
    solidWorker = null;
    solidHasTexture = false; // tidy up so a stray volume can't leak into a future session's gap.
    ui.setSolidResolutionNote(null);
    state = setSolidActive(state, false);
    refreshUi();
  }

  // The lens has no guide box, so map its selection (like camera) to "nothing
  // highlighted" — only a numbered transform highlights a box or is draggable.
  function selectedBox(): number | null {
    return typeof state.selectedTransform === "number"
      ? state.selectedTransform
      : null;
  }

  function refreshGuides(): void {
    scene.updateGuides(state.transforms, selectedBox(), state.showGuides);
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

  // Debounced saver — persists 300 ms after the last scene-affecting change so
  // rapid slider drags don't flood history/storage on every tick.
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  function scheduleSave(): void {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveScene(toSnapshot(state));
    }, 300);
  }

  // Flush any pending debounced save on page hide so an edit made less than
  // 300 ms before the tab is closed or backgrounded is not lost. Reuses the
  // guarded saveScene path, which already handles SecurityError (sandboxed
  // iframes) and private-mode localStorage failures without throwing.
  function flushSave(): void {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    saveScene(toSnapshot(state));
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushSave();
  });
  window.addEventListener("pagehide", flushSave);

  /**
   * Shared choreography for edits that replace or modify the transform set.
   *
   * Centralises the autoUpdate policy in one place:
   *   "auto"   — regenerate only when autoUpdate is on (add/remove/drag edits)
   *   "always" — always regenerate regardless of autoUpdate (preset loads must
   *               rebuild because the entire transform set is replaced)
   *
   * After applying the reducer, every geometry edit refreshes the guide boxes
   * and the UI, then schedules a debounced save.
   */
  function applyEdit(
    applyReducer: () => void,
    effect: "auto" | "always" = "auto",
  ): void {
    applyReducer();
    refreshGuides();
    refreshUi();
    if (effect === "always" || state.autoUpdate) regenerate();
    scheduleSave();
  }

  ui.bind({
    onAdd: () =>
      applyEdit(() => {
        state = addTransform(state);
      }),
    onRemove: () =>
      applyEdit(() => {
        state = removeTransform(state);
      }),
    onPreset: (preset) => {
      applyEdit(() => {
        state = setTransforms(state, presetTransforms(preset));
      }, "always");
      fitCameraToAttractor();
    },
    onSurprise: () => {
      applyEdit(() => {
        const sys = randomSystem(Math.random);
        state = setTransforms(state, sys.transforms);
        // sys.finalTransform is Transform | null; setFinalTransform treats
        // null as "clear" (stores undefined), so a previous session's lens
        // never survives a roll that landed on no final transform.
        state = setFinalTransform(state, sys.finalTransform);
      }, "always");
      fitCameraToAttractor();
    },
    onNumPointsInput: (value) => {
      state = setNumPoints(state, value);
      ui.updateLabels(state);
      scheduleSave();
    },
    onPointSizeInput: (value) => {
      state = setPointSize(state, value);
      scene.setPointSize(value);
      ui.updateLabels(state);
      scheduleSave();
    },
    onGlowBrightnessInput: (value) => {
      // No direct scene push needed: animate()'s per-frame glow-exposure
      // calculation already reads state.glowBrightness as a multiplier.
      state = setGlowBrightness(state, value);
      ui.updateLabels(state);
      scheduleSave();
    },
    onRegenerate: () => regenerate(),
    onSavePng: () => {
      // Capture the bare WebGL canvas (fractal + backdrop, no UI chrome) — or,
      // while a flame render is active, its own 2D canvas (true alpha; see
      // captureFlameFrame) — or, while a solid render is active, a fresh
      // raymarch of the live camera (captureSolidFrame) — and hand it to the
      // browser as a timestamped download.
      const link = document.createElement("a");
      link.href = state.solidActive
        ? scene.captureSolidFrame()
        : state.flameActive
          ? scene.captureFlameFrame()
          : scene.captureFrame();
      link.download = `fractal-${Date.now()}.png`;
      link.click();
    },
    onToggleGuides: (checked) => {
      state = setShowGuides(state, checked);
      scene.setGuidesVisible(checked);
      refreshUi();
      scheduleSave();
    },
    onColorMode: (mode) => {
      state = setColorMode(state, mode);
      recolor();
      scheduleSave();
    },
    onRenderStyle: (style) => {
      state = setRenderStyle(state, style);
      scene.setRenderStyle(style);
      // Reset glow exposure so no stale factor sticks when switching away.
      if (style !== "glow") scene.setGlowExposure(1);
      // Refresh labels so the glow-brightness row (fr-8b1) shows/hides
      // immediately — previously nothing in this handler depended on
      // renderStyle-conditional DOM, so the sync was never needed here.
      ui.updateLabels(state);
      scheduleSave();
    },
    onToggleAutoUpdate: (checked) => {
      state = setAutoUpdate(state, checked);
    },
    onSymmetryOrderInput: (value) => {
      state = setSymmetryOrder(state, value);
      ui.updateLabels(state);
      if (state.autoUpdate) regenerate();
      postFlame({
        type: "setSymmetry",
        order: state.symmetry.order,
        axis: state.symmetry.axis,
      });
      postVoxel({
        type: "setSymmetry",
        order: state.symmetry.order,
        axis: state.symmetry.axis,
      });
      scheduleSave();
    },
    onSymmetryAxisChange: (axis) => {
      state = setSymmetryAxis(state, axis);
      ui.updateLabels(state);
      if (state.autoUpdate) regenerate();
      postFlame({
        type: "setSymmetry",
        order: state.symmetry.order,
        axis: state.symmetry.axis,
      });
      postVoxel({
        type: "setSymmetry",
        order: state.symmetry.order,
        axis: state.symmetry.axis,
      });
      scheduleSave();
    },
    onSelect: (index) => {
      state = selectTransform(state, index);
      refreshGuides();
      refreshUi();
    },
    onTransformGeometry: (index, geometry) => {
      state = updateTransform(state, index, geometry);
      scene.setGuideGeometry(index, geometry);
      ui.renderTransformList(
        state.transforms,
        state.selectedTransform,
        state.finalTransform ?? null,
      );
      if (state.autoUpdate) regenerate();
      scheduleSave();
    },
    onToggleFinalTransform: (checked) =>
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
      }),
    onFinalTransformGeometry: (geometry) => {
      state = setFinalTransform(state, { id: 0, ...geometry });
      ui.renderTransformList(
        state.transforms,
        state.selectedTransform,
        state.finalTransform ?? null,
      );
      if (state.autoUpdate) regenerate();
      scheduleSave();
    },
    onTogglePanel: () => {
      state = setPanelOpen(state, !state.panelOpen);
      ui.updateLabels(state);
    },
    onClosePanel: () => {
      state = setPanelOpen(state, false);
      ui.updateLabels(state);
    },
    onEnterFlameRender: () => enterFlameMode(),
    onExitFlameRender: () => exitFlameMode(),
    onFlameExposureInput: (value) => {
      state = setFlameExposure(state, value);
      ui.updateLabels(state);
      // Shared mode: the tone-map runs on THIS thread over the live shared
      // buckets, so the change lands instantly — even mid-chunk, when the
      // worker couldn't service a command anyway. Transfer mode: the worker
      // owns the tone-map; forward as before. Same split for gamma/vibrancy.
      if (flameShared) presentSharedFrame();
      else postFlame({ type: "setExposure", exposure: state.flame.exposure });
      scheduleSave();
    },
    onFlameIterationsInput: (value) => {
      state = setFlameIterations(state, value);
      ui.updateLabels(state);
      postFlame({
        type: "setIterationsBudget",
        iterations: state.flame.iterations,
      });
      scheduleSave();
    },
    onFlameGammaInput: (value) => {
      state = setFlameGamma(state, value);
      ui.updateLabels(state);
      if (flameShared) presentSharedFrame();
      else postFlame({ type: "setGamma", gamma: state.flame.gamma });
      scheduleSave();
    },
    onFlameVibrancyInput: (value) => {
      state = setFlameVibrancy(state, value);
      ui.updateLabels(state);
      if (flameShared) presentSharedFrame();
      else postFlame({ type: "setVibrancy", vibrancy: state.flame.vibrancy });
      scheduleSave();
    },
    onFlameSupersampleInput: (value) => {
      // The reducer clamps/rounds; the worker compares the settled value
      // against its own effective supersample and restarts accumulation for
      // us if it actually changed — no need to restart here directly (and
      // refreshUi/regenerate would be premature: the display size hasn't
      // changed, only the accumulator's).
      state = setFlameSupersample(state, value);
      ui.updateLabels(state);
      postFlame({
        type: "setSupersample",
        supersample: state.flame.supersample,
      });
      scheduleSave();
    },
    onFlamePaletteChange: (paletteId) => {
      // Like supersample this restarts accumulation in the worker (the color
      // sums bake in the palette); the worker owns that restart, so this just
      // updates state + label and forwards the new palette.
      state = setFlamePaletteId(state, paletteId);
      ui.updateLabels(state);
      postFlame({ type: "setPalette", paletteId: state.flame.paletteId });
      scheduleSave();
    },
    onFlameEstimatorRadiusInput: (value) => {
      state = setFlameEstimatorRadius(state, value);
      ui.updateLabels(state);
      postFlame({
        type: "setEstimatorRadius",
        estimatorRadius: state.flame.estimatorRadius,
      });
      scheduleSave();
    },
    onFlameEstimatorMinimumRadiusInput: (value) => {
      state = setFlameEstimatorMinimumRadius(state, value);
      ui.updateLabels(state);
      postFlame({
        type: "setEstimatorMinimumRadius",
        estimatorMinimumRadius: state.flame.estimatorMinimumRadius,
      });
      scheduleSave();
    },
    onFlameEstimatorCurveInput: (value) => {
      state = setFlameEstimatorCurve(state, value);
      ui.updateLabels(state);
      postFlame({
        type: "setEstimatorCurve",
        estimatorCurve: state.flame.estimatorCurve,
      });
      scheduleSave();
    },
    onEnterSolidRender: () => enterSolidMode(),
    onExitSolidRender: () => exitSolidMode(),
    onSolidThresholdInput: (value) => {
      state = setSolidThreshold(state, value);
      ui.updateLabels(state);
      scene.setSolidParams(state.solid);
      scheduleSave();
    },
    onSolidLightAzimuthInput: (value) => {
      state = setSolidLightAzimuth(state, value);
      ui.updateLabels(state);
      scene.setSolidParams(state.solid);
      scheduleSave();
    },
    onSolidLightElevationInput: (value) => {
      state = setSolidLightElevation(state, value);
      ui.updateLabels(state);
      scene.setSolidParams(state.solid);
      scheduleSave();
    },
    onSolidAmbientInput: (value) => {
      state = setSolidAmbient(state, value);
      ui.updateLabels(state);
      scene.setSolidParams(state.solid);
      scheduleSave();
    },
    onSolidPaletteChange: (paletteId) => {
      // Like resolution this restarts accumulation in the worker (the
      // colors bake into avgRGB); the worker owns that restart, so this
      // just updates state + label and forwards the new palette.
      state = setSolidPaletteId(state, paletteId);
      ui.updateLabels(state);
      postVoxel({ type: "setPalette", paletteId: state.solid.paletteId });
      scheduleSave();
    },
    onSolidIterationsInput: (value) => {
      state = setSolidIterations(state, value);
      ui.updateLabels(state);
      postVoxel({
        type: "setIterationsBudget",
        iterations: state.solid.iterations,
      });
      scheduleSave();
    },
    onSolidResolutionInput: (value) => {
      // The reducer clamps/snaps to the voxel step; unlike the flame's
      // supersample the worker has no live "change resolution" command (a
      // grid's dimensions are fixed at allocation), so a genuine change while
      // active restarts the whole session via enterSolidMode — a fresh
      // worker, exactly like a Render click.
      const previousResolution = state.solid.resolution;
      state = setSolidResolution(state, value);
      ui.updateLabels(state);
      scheduleSave();
      if (state.solidActive && state.solid.resolution !== previousResolution) {
        enterSolidMode();
      }
    },
  });

  attachInteractions(scene, orbit, {
    selectedTransform: selectedBox,
    frozen: () => state.flameActive,
    onTransformChange: (index, geometry) => {
      state = updateTransform(state, index, geometry);
      ui.renderTransformList(
        state.transforms,
        state.selectedTransform,
        state.finalTransform ?? null,
      );
      ui.renderTransformEditor(state.transforms[index], index);
      if (state.autoUpdate) regenerate();
      scheduleSave();
    },
  });

  window.addEventListener("resize", () => {
    scene.resize(window.innerWidth, window.innerHeight);
    // Backdrop visibility depends on the viewport width (mobile scrim), so
    // crossing MOBILE_BREAKPOINT — e.g. rotating a phone to landscape with
    // the panel open — must re-sync it or the scrim sticks around.
    ui.updateLabels(state);
  });

  const loading = document.getElementById("loading");
  if (loading) loading.style.display = "none";
  scene.setRenderStyle(state.renderStyle);
  scene.setPointSize(state.pointSize);
  refreshGuides();
  // Match grid/axes to the initial (possibly restored) guide visibility, since
  // refreshGuides only governs the per-transform boxes.
  scene.setGuidesVisible(state.showGuides);
  regenerate();
  refreshUi();

  // While a flame render is active, accumulation/downsample/tone-map all
  // happen in the worker (see flame-worker-core.ts) and arrive as "progress"
  // events (handleFlameEvent) — this loop just keeps redrawing whatever
  // image was most recently uploaded via scene.setFlameImage.
  function animate(): void {
    requestAnimationFrame(animate);
    advanceCameraTween();
    if (state.solidActive) {
      // Unlike the flame's frozen view, the volume is world-space: keep
      // applying the live orbit camera so the user can keep looking around
      // while accumulation converges.
      scene.applyCamera(orbit);
      if (solidHasTexture) {
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
    if (state.flameActive) {
      // Keep drawing the frozen explorer view (already-applied camera, no
      // further orbit input while flameActive) until the worker's first
      // image lands, then switch over — avoids a flash of the flame
      // canvas's stale contents during the worker startup gap.
      if (flameHasImage) {
        scene.renderFlame();
      } else {
        scene.render();
      }
      return;
    }
    scene.applyCamera(orbit);
    scene.updateFog();
    // Density-adaptive glow brightness: dim dense clouds, brighten sparse
    // ones. state.glowBrightness (fr-8b1) then layers the user's manual
    // override on top — auto-exposure only sees the *average* screen
    // density, so local density swings still need a hand-tuned correction.
    if (state.renderStyle === "glow" && lastResult) {
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

registerServiceWorker();
main();
