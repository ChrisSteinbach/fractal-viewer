import {
  prepareChaosGame,
  runChaosGame,
  type ChaosGameResult,
  type PreparedChaosGame,
} from "../fractal/chaos-game";
import { buildColors, transformColors } from "../fractal/color";
import {
  DEFAULT_GAMMA_THRESHOLD,
  accumulateFlame,
  downsampleFlame,
  tonemapFlame,
} from "../fractal/flame";
import type { FlameHistogram, Mat4 } from "../fractal/flame";
import type { Vec3 } from "../fractal/types";
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

/**
 * Iterations accumulated per animation frame while a flame render converges.
 * Self-adjusts toward {@link FLAME_FRAME_BUDGET_MS} (see `animate`'s flame
 * branch) — this is only the seed for the very first chunk, chosen small and
 * safe rather than tuned to any particular machine.
 */
const FLAME_CHUNK_INITIAL = 1_000_000;
const FLAME_CHUNK_MIN = 100_000;
const FLAME_CHUNK_MAX = 20_000_000;
/** Target wall-clock time per accumulation chunk, leaving headroom in a
 * 16 ms (60 fps) frame for the tone-map pass, texture upload, and everything
 * else the tab needs to stay responsive. */
const FLAME_FRAME_BUDGET_MS = 8;

/**
 * Fixed reconstruction-filter radius (in display pixels) `downsampleFlame`
 * blurs with — see its doc for why a plain fixed radius, not yet the
 * density-adaptive one fr-17t will add. Small on purpose: the filter's cost
 * grows with radius^2, and — unlike accumulation — it isn't chunked, so it
 * has to stay cheap enough for {@link FLAME_REDISPLAY_INTERVAL_MS} to hold.
 */
const FLAME_FILTER_RADIUS = 0.4;
/**
 * Minimum time between downsample + tone-map + upload refreshes while a
 * flame render is actively converging. Accumulation itself still runs every
 * animation frame (self-tuned as above); only the (much more expensive,
 * O(width * height * filterRadius^2) and NOT chunked) redisplay is
 * throttled, so a slow downsample degrades the update rate instead of
 * stalling every single frame. The very first chunk and the final "done"
 * frame both bypass this — see `stepFlame`.
 */
const FLAME_REDISPLAY_INTERVAL_MS = 150;

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

  // Flame render session (fr-o7s/fr-ucs): runtime accumulation state for the
  // in-progress render, valid only while state.flameActive. Not part of
  // AppState — like lastResult, it is cached/derived, not a source of truth,
  // and unlike AppState it cannot be usefully persisted (an accumulated
  // histogram is huge and tied to a since-possibly-moved camera).
  let flamePrepared: PreparedChaosGame | null = null;
  let flameProjection: Mat4 | null = null;
  let flamePalette: Vec3[] = [];
  // The real progressive accumulator: accumulates at flameWidth/flameHeight
  // TIMES the current supersample factor. flameDisplayHistogram is a
  // display-only derivative — never fed back into accumulateFlame (see
  // downsampleFlame's doc) — refreshed from it on the cadence stepFlame
  // decides below.
  let flameHistogram: FlameHistogram | null = null;
  let flameDisplayHistogram: FlameHistogram | null = null;
  // Display resolution — fixed for the life of a render (the frozen camera's
  // size). flameAccumWidth/Height are this scaled by the CURRENT
  // supersample and are what accumulateFlame actually targets.
  let flameWidth = 0;
  let flameHeight = 0;
  let flameAccumWidth = 0;
  let flameAccumHeight = 0;
  // The supersample factor flameHistogram was created at — compared against
  // state.flame.supersample every stepFlame to detect a live change (see
  // startFlameAccumulation).
  let flameSupersampleUsed = 1;
  let flameIterationsDone = 0;
  let flameLastExposure: number | undefined;
  let flameLastGamma: number | undefined;
  let flameLastVibrancy: number | undefined;
  // undefined until the first downsample+tonemap+upload of this render, so
  // that first one is never throttled (see stepFlame).
  let flameLastDownsampleAt: number | undefined;
  let flameChunkSize = FLAME_CHUNK_INITIAL;

  // (Re)size the accumulator for state.flame.supersample and discard any
  // progress: shared by entering flame mode and by a live supersample
  // change mid-render, both of which need a from-scratch histogram at a new
  // size. Assumes flameWidth/flameHeight (the display size) are already set.
  function startFlameAccumulation(): void {
    const supersample = state.flame.supersample;
    flameAccumWidth = flameWidth * supersample;
    flameAccumHeight = flameHeight * supersample;
    flameSupersampleUsed = supersample;
    flameHistogram = null;
    flameDisplayHistogram = null;
    flameIterationsDone = 0;
    flameLastExposure = undefined;
    flameLastGamma = undefined;
    flameLastVibrancy = undefined;
    flameLastDownsampleAt = undefined;
    flameChunkSize = FLAME_CHUNK_INITIAL;
  }

  // Freeze the current camera and start converging a flame render of it.
  // Called only from the Render button — never automatically — so the
  // explorer stays the default, always-interactive experience.
  function enterFlameMode(): void {
    const { width, height } = scene.flameRenderSize();
    flameWidth = width;
    flameHeight = height;
    flamePrepared = prepareChaosGame(
      state.transforms,
      state.finalTransform ?? null,
    );
    flameProjection = scene.flameProjectionMatrix();
    flamePalette = transformColors(state.transforms.length);
    startFlameAccumulation();
    state = setFlameActive(state, true);
    refreshUi();
  }

  // Discard the in-progress render and return to the live explorer, exactly
  // as it was left (the camera/orbit was never touched while rendering).
  function exitFlameMode(): void {
    flamePrepared = null;
    flameProjection = null;
    flameHistogram = null;
    flameDisplayHistogram = null;
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
      scheduleSave();
    },
    onFlameIterationsInput: (value) => {
      state = setFlameIterations(state, value);
      ui.updateLabels(state);
      scheduleSave();
    },
    onFlameGammaInput: (value) => {
      state = setFlameGamma(state, value);
      ui.updateLabels(state);
      scheduleSave();
    },
    onFlameVibrancyInput: (value) => {
      state = setFlameVibrancy(state, value);
      ui.updateLabels(state);
      scheduleSave();
    },
    onFlameSupersampleInput: (value) => {
      // The reducer clamps/rounds; stepFlame compares the settled value
      // against flameSupersampleUsed and restarts accumulation for us next
      // frame — no need to restart here directly (and refreshUi/regenerate
      // would be premature: the display size hasn't changed, only the
      // accumulator's).
      state = setFlameSupersample(state, value);
      ui.updateLabels(state);
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

  // Accumulate one flame-render chunk into the (possibly supersampled)
  // accumulator, periodically downfilter it to display resolution, and
  // re-tone-map + upload whenever the displayed image should change.
  // Self-adjusts flameChunkSize toward FLAME_FRAME_BUDGET_MS so the
  // accumulate step stays responsive regardless of the machine's actual
  // throughput, which nothing in this environment can be profiled against
  // ahead of time. The (much pricier, unchunked) downsample pass is instead
  // rate-limited by FLAME_REDISPLAY_INTERVAL_MS — see its doc.
  function stepFlame(): void {
    if (!flamePrepared || !flameProjection) return;

    // The supersample slider is live-editable mid-render (it lives in the
    // same panel as exposure/iterations), but changes the accumulator's
    // dimensions, so there is nothing to carry forward — restart flat.
    if (state.flame.supersample !== flameSupersampleUsed) {
      startFlameAccumulation();
    }

    let needsRedraw = false;

    if (flameIterationsDone < state.flame.iterations) {
      const chunk = Math.min(
        flameChunkSize,
        state.flame.iterations - flameIterationsDone,
      );
      const start = performance.now();
      flameHistogram = accumulateFlame(
        flamePrepared,
        flameProjection,
        flameAccumWidth,
        flameAccumHeight,
        chunk,
        Math.random,
        flamePalette,
        flameHistogram ?? undefined,
      );
      const elapsed = performance.now() - start;
      flameIterationsDone += chunk;

      if (elapsed > 0) {
        // Damped multiplicative correction (capped to 0.5x–2x per frame) so
        // one slow frame (e.g. a GC pause) doesn't overcorrect wildly.
        const scale = Math.min(
          2,
          Math.max(0.5, FLAME_FRAME_BUDGET_MS / elapsed),
        );
        flameChunkSize = Math.round(
          Math.min(
            FLAME_CHUNK_MAX,
            Math.max(FLAME_CHUNK_MIN, flameChunkSize * scale),
          ),
        );
      }

      // Refresh the display-resolution histogram now if this is the very
      // first chunk (nothing on screen yet), the render just finished (show
      // the fully-converged result promptly, not up to an interval stale),
      // or the redisplay interval has elapsed — never on every single
      // chunk, since downsampleFlame is comparatively expensive and isn't
      // itself chunked.
      const now = performance.now();
      const finished = flameIterationsDone >= state.flame.iterations;
      const due =
        finished ||
        flameLastDownsampleAt === undefined ||
        now - flameLastDownsampleAt >= FLAME_REDISPLAY_INTERVAL_MS;
      if (due) {
        flameDisplayHistogram = downsampleFlame(
          flameHistogram,
          flameWidth,
          flameHeight,
          FLAME_FILTER_RADIUS,
        );
        flameLastDownsampleAt = now;
        needsRedraw = true;
      }
    } else if (
      flameLastExposure !== state.flame.exposure ||
      flameLastGamma !== state.flame.gamma ||
      flameLastVibrancy !== state.flame.vibrancy
    ) {
      // Done accumulating: exposure/gamma/vibrancy re-tone-map the cached
      // display histogram live — never a re-downsample, let alone a
      // re-accumulate.
      needsRedraw = true;
    }

    if (needsRedraw && flameDisplayHistogram) {
      flameLastExposure = state.flame.exposure;
      flameLastGamma = state.flame.gamma;
      flameLastVibrancy = state.flame.vibrancy;
      const image = tonemapFlame(flameDisplayHistogram, {
        exposure: state.flame.exposure,
        gamma: state.flame.gamma,
        gammaThreshold: DEFAULT_GAMMA_THRESHOLD,
        vibrancy: state.flame.vibrancy,
      });
      scene.setFlameImage(image, flameWidth, flameHeight);
      ui.setFlameProgress(flameIterationsDone, state.flame.iterations);
    }
    scene.renderFlame();
  }

  function animate(): void {
    requestAnimationFrame(animate);
    if (state.flameActive) {
      stepFlame();
      return;
    }
    scene.applyCamera(orbit);
    scene.updateFog();
    scene.render();
  }
  animate();
}

main();
