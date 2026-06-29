import { runChaosGame } from "../fractal/chaos-game";
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
import { loadScene, saveScene } from "./persist";
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
    ? {
        ...initialState(panelOpen),
        transforms: saved.transforms,
        numPoints: saved.numPoints,
        pointSize: saved.pointSize,
        colorMode: saved.colorMode,
        renderStyle: saved.renderStyle,
        showGuides: saved.showGuides,
      }
    : initialState(panelOpen);
  const orbit = new OrbitCamera([5, 4, 5]);
  const ui = new Ui(document);

  function regenerate(): void {
    const result = runChaosGame(state.transforms, state.numPoints);
    const colors = buildColors(result, state.transforms, state.colorMode);
    scene.setPoints(result.positions, colors);
    ui.setPointCount(result.count);
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
      saveScene({
        transforms: state.transforms,
        numPoints: state.numPoints,
        pointSize: state.pointSize,
        colorMode: state.colorMode,
        renderStyle: state.renderStyle,
        showGuides: state.showGuides,
      });
    }, 300);
  }

  ui.bind({
    onAdd: () => {
      state = addTransform(state);
      refreshGuides();
      refreshUi();
      if (state.autoUpdate) regenerate();
      scheduleSave();
    },
    onRemove: () => {
      state = removeTransform(state);
      refreshGuides();
      refreshUi();
      if (state.autoUpdate) regenerate();
      scheduleSave();
    },
    onPreset: (preset) => {
      state = setTransforms(state, presetTransforms(preset));
      refreshGuides();
      refreshUi();
      regenerate();
      scheduleSave();
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
    onRegenerate: () => regenerate(),
    onToggleGuides: (checked) => {
      state = setShowGuides(state, checked);
      scene.setGuidesVisible(checked);
      refreshUi();
      scheduleSave();
    },
    onColorMode: (mode) => {
      state = setColorMode(state, mode);
      regenerate();
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
