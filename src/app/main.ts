import { runChaosGame, type ChaosGameResult } from "../fractal/chaos-game";
import { buildColors } from "../fractal/color";
import {
  dodecahedronFlake,
  icosahedronFlake,
  mengerSponge,
  octahedronFlake,
  sierpinskiPyramid,
  sierpinskiTetrahedron,
  spiral,
} from "../fractal/presets";
import { OrbitCamera } from "./orbit";
import { FractalScene } from "./scene";
import { attachInteractions } from "./interactions";
import { Ui } from "./ui";
import type { Preset } from "./ui";
import {
  addTransform,
  initialState,
  removeTransform,
  selectTransform,
  setAutoUpdate,
  setColorMode,
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
import type { Transform } from "../fractal/types";

/** Below this viewport width the panel starts closed and floats over a scrim. */
const MOBILE_BREAKPOINT = 640;

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

function presetTransforms(preset: Preset): Transform[] {
  switch (preset) {
    case "sierpinski":
      return sierpinskiTetrahedron();
    case "menger":
      return mengerSponge();
    case "spiral":
      return spiral();
    case "pyramid":
      return sierpinskiPyramid();
    case "octahedron":
      return octahedronFlake();
    case "icosahedron":
      return icosahedronFlake();
    case "dodecahedron":
      return dodecahedronFlake();
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
    lastResult = runChaosGame(state.transforms, state.numPoints);
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

  function refreshGuides(): void {
    scene.updateGuides(
      state.transforms,
      state.selectedTransform,
      state.showGuides,
    );
  }

  function refreshUi(): void {
    ui.updateLabels(state);
    ui.renderTransformList(state.transforms, state.selectedTransform);
    const selected = state.selectedTransform;
    ui.renderTransformEditor(
      selected === null ? null : state.transforms[selected],
      selected,
    );
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
      // Capture the bare WebGL canvas (fractal + backdrop, no UI chrome) and
      // hand it to the browser as a timestamped download.
      const link = document.createElement("a");
      link.href = scene.captureFrame();
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
      ui.renderTransformList(state.transforms, state.selectedTransform);
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
  });

  attachInteractions(scene, orbit, {
    selectedTransform: () => state.selectedTransform,
    onTransformChange: (index, geometry) => {
      state = updateTransform(state, index, geometry);
      ui.renderTransformList(state.transforms, state.selectedTransform);
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

  function animate(): void {
    requestAnimationFrame(animate);
    scene.applyCamera(orbit);
    scene.updateFog();
    scene.render();
  }
  animate();
}

main();
