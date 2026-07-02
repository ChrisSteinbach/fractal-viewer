import { runChaosGame, type ChaosGameResult } from "../fractal/chaos-game";
import { buildColors } from "../fractal/color";
import type { FlameWorkerCommand, FlameWorkerEvent } from "./flame-worker-core";
import { defaultFinalTransform, presetTransforms } from "../fractal/presets";
import { OrbitCamera } from "./orbit";
import { FractalScene } from "./scene";
import { attachInteractions } from "./interactions";
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
  setFlameExposure,
  setFlameGamma,
  setFlameIterations,
  setFlameSupersample,
  setFlameVibrancy,
  setNumPoints,
  setPanelOpen,
  setPointSize,
  setRenderStyle,
  setShowGuides,
  setTransforms,
  updateTransform,
} from "./state";
import type { AppState } from "./state";
import { fromSnapshot, loadScene, saveScene, toSnapshot } from "./persist";
import { MOBILE_BREAKPOINT } from "./constants";

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
  const orbit = new OrbitCamera([5, 4, 5]);
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

  // Flame render session (fr-o7s/fr-ucs/fr-73y): a Web Worker owns the
  // supersampled accumulation, the OOM guard, the throttled downsample, and
  // the tone-map (see flame-worker-core.ts) — this is thin glue that spins
  // one up per render and forwards UI events as messages. NOT
  // SharedArrayBuffer (GitHub Pages cannot set the COOP/COEP headers that
  // needs): the worker keeps its big oversampled histogram entirely to
  // itself and only ever transfers back a small display-resolution image.
  let flameWorker: Worker | null = null;
  // True once the CURRENT session's first "progress" image has arrived.
  // Spinning up a worker (and the round trip to its first accumulate +
  // downsample + tone-map) takes real time, unlike fr-o7s's synchronous
  // first stepFlame call — animate() uses this to keep showing the frozen
  // explorer view for that gap instead of a flash of the flame canvas's
  // stale contents (blank on a first-ever render, or the PREVIOUS render's
  // image on a repeat one, since neither enter nor exit clears it).
  let flameHasImage = false;

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
      case "supersampleNote":
        ui.setFlameSupersampleNote(event.effective, event.requested);
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
    ui.setFlameSupersampleNote(null);
    flameHasImage = false; // tidy up so a stray flame frame can't leak into a future session's gap.
    state = setFlameActive(state, false);
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
    onPreset: (preset) =>
      applyEdit(() => {
        state = setTransforms(state, presetTransforms(preset));
      }, "always"),
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
    onRegenerate: () => regenerate(),
    onSavePng: () => {
      // Capture the bare WebGL canvas (fractal + backdrop, no UI chrome) — or,
      // while a flame render is active, its own 2D canvas (true alpha; see
      // captureFlameFrame) — and hand it to the browser as a timestamped
      // download.
      const link = document.createElement("a");
      link.href = state.flameActive
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
      scheduleSave();
    },
    onToggleAutoUpdate: (checked) => {
      state = setAutoUpdate(state, checked);
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
      postFlame({ type: "setExposure", exposure: state.flame.exposure });
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
      postFlame({ type: "setGamma", gamma: state.flame.gamma });
      scheduleSave();
    },
    onFlameVibrancyInput: (value) => {
      state = setFlameVibrancy(state, value);
      ui.updateLabels(state);
      postFlame({ type: "setVibrancy", vibrancy: state.flame.vibrancy });
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
    scene.render();
  }
  animate();
}

main();
