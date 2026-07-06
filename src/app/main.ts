import { runChaosGame, type ChaosGameResult } from "../fractal/chaos-game";
import { runChaosGame4 } from "../fractal/chaos-game-4d";
import type { ChaosGame4Result } from "../fractal/chaos-game-4d";
import { toTransform4 } from "../fractal/affine4";
import { identityRotorPair, rotateInPlane, rotorMatrix } from "./rotor4";
import type { RotorPair } from "./rotor4";
import { buildColors } from "../fractal/color";
import {
  DEFAULT_GAMMA_THRESHOLD,
  tonemapFlame,
  viewFlameHistogram,
} from "../fractal/flame";
import { flameAccumBudgetBuckets } from "./flame-worker-core";
import type { FlameWorkerCommand, FlameWorkerEvent } from "./flame-worker-core";
import type { SharedFrameBuffers } from "./flame-worker-core";
import { voxelAccumBudgetVoxels } from "./voxel-worker-core";
import type { VoxelWorkerCommand, VoxelWorkerEvent } from "./voxel-worker-core";
import { glowExposure } from "./exposure";
import {
  defaultFinalTransform,
  PRESET_SCAFFOLDS,
  presetTransforms,
} from "../fractal/presets";
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
import { SceneHistory } from "./history";
import {
  addTransform,
  initialState,
  removeTransform,
  selectTransform,
  setAutoUpdate,
  setColorGamma,
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
  systemIsNonFlat,
  updateTransform,
} from "./state";
import type { AppState } from "./state";
import {
  decodeScene,
  encodeScene,
  fromSnapshot,
  loadScene,
  saveScene,
  toSnapshot,
} from "./persist";
import { MOBILE_BREAKPOINT } from "./constants";
import type { Bounds, Vec3, Vec4 } from "../fractal/types";

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

/** True when the user asked the OS to minimize non-essential motion. Reused by
 * the camera auto-fit and the 4D auto-tumble, both of which fall back to a
 * static view when it holds. */
function prefersReducedMotion(): boolean {
  return (
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true
  );
}

/**
 * Auto-tumble BASE rates for the 4D projection (fr-cbg spike): the XY- and
 * ZW-plane angular speeds in rad/s at the default 1x tumble speed (fr-woc
 * multiplies these by the user's speed slider — see `fourDTumbleSpeed`).
 * Slow and deliberately incommensurate-ish (~48 s and ~30 s per revolution at
 * 1x) so the double rotation never visibly loops.
 */
const FOUR_D_XY_RATE = 0.13;
const FOUR_D_ZW_RATE = 0.21;

/**
 * Synthesize a 3D {@link Bounds} for framing a 4D projection: an axis-aligned
 * box on the cloud's xyz center whose half-DIAGONAL equals `radius`, so
 * orbit.ts's `fitRadius` (which reads the box as a bounding sphere of radius =
 * half-diagonal) frames exactly the radius-`radius` 4D ball. Half-extent per
 * axis is radius/√3 ⇒ half-diagonal √3·(radius/√3) = radius. Because `radius`
 * is a rotation-invariant max-distance-from-center, this framing holds at every
 * tumble angle and never needs to re-run. `minR`/`maxR` aren't read by
 * `fitRadius`/`boundsCenter` but are filled to `[0, radius]` for a well-formed
 * box.
 */
function fourDFramingBounds(center: Vec4, radius: number): Bounds {
  const h = radius / Math.sqrt(3);
  return {
    minX: center[0] - h,
    maxX: center[0] + h,
    minY: center[1] - h,
    maxY: center[1] + h,
    minZ: center[2] - h,
    maxZ: center[2] + h,
    minR: 0,
    maxR: radius,
  };
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

  // Whether the CURRENT system needs the 4D projection view — a DERIVED
  // property of state.transforms/finalTransform (fr-bf6; see state.ts's
  // systemIsNonFlat), not a mode the user enters/exits. Cached here (rather
  // than recomputed on every animation frame or pointer move) by regenerate(),
  // its only writer; animate()'s tumble tick, the interactions predicate, and
  // guide-box suppression all read it.
  let viewIs4D = false;

  // The most recent 4D chaos-game run — mirrors `lastResult` for the 3D path,
  // so a whole-system replacement (preset load / Surprise Me) can auto-frame
  // the camera on it right after regenerate() lands a fresh run (see
  // fitCameraToAttractor). Null whenever the view isn't showing 4D.
  let fourDResult: ChaosGame4Result | null = null;
  // The accumulated 4D VIEW rotation (fr-woc): tumble ticks and Shift-drag/
  // Shift-wheel deltas all compose into this one quaternion pair (see
  // rotor4.ts), converted to a matrix only where scene.setRot4 needs it. That
  // single accumulator is what makes pausing freeze the exact current
  // orientation and what lets a drag mid-tumble just add on top, instead of
  // fighting a separately-tracked clock. Session-only, like the slice below:
  // reset to identity by resetFourDView() whenever the view starts showing a
  // genuinely new 4D system, never persisted.
  let fourDPair: RotorPair = identityRotorPair();
  let fourDTumbleOn = true;
  let fourDTumbleSpeed = 1;
  let fourDLastTickMs = 0;
  // The soft w-slice (fr-6x2): session-only view state, reset by
  // resetFourDView() alongside the rotor pair above.
  let fourDSliceOn = false;
  let fourDSliceCenter = 0;

  // Reset the 4D VIEW state to a "fresh visit" baseline — rotor pair to
  // identity, tumble running (paused under reduced motion, but pre-seeded on
  // one generic orientation so the projection still reads as 4D at a glance),
  // default speed, slice off and centered. Extracted from the old per-mode
  // entry sequence (fr-cbg/fr-woc/fr-6x2): now that "4D" is a property of the
  // system rather than a mode, this fires from regenerate() on (a) a
  // flat→non-flat transition and (b) a whole-system replacement (preset load
  // / Surprise Me) that lands on a non-flat system — never on a subsequent
  // edit to an already-4D system, so nudging a slider can't throw away an
  // in-progress tumble/slice.
  function resetFourDView(): void {
    fourDPair = identityRotorPair();
    const reducedMotion = prefersReducedMotion();
    fourDTumbleOn = !reducedMotion;
    fourDTumbleSpeed = 1;
    fourDLastTickMs = performance.now();
    if (reducedMotion) {
      fourDPair = rotateInPlane(fourDPair, "xy", 0.6);
      fourDPair = rotateInPlane(fourDPair, "zw", 0.9);
    }
    fourDSliceOn = false;
    fourDSliceCenter = 0;
    scene.setFourDSlice(fourDSliceOn, fourDSliceCenter);
    ui.resetFourDSlice();
    ui.resetFourDTumble(fourDTumbleOn);
  }

  // Re-run the chaos game: the only path that touches the RNG and changes point
  // positions. Use this for geometry edits, add/remove, presets, and explicit
  // regenerate — never for a mere palette change.
  //
  // Routes on the system's FLATNESS (fr-bf6; see affine4.ts's systemIsFlat/
  // isFlatTransform via state.ts's systemIsNonFlat): a flat system — no
  // transform's `w` block in play, final transform included per its own
  // enabled semantics — takes the untouched 3D path, bit-identical to before
  // this system ever had a `w` extension; a non-flat one lifts every
  // transform (and the final lens, if enabled) through toTransform4 and runs
  // the 4D chaos game instead. `replaced` marks a WHOLE-SYSTEM replacement
  // (preset load / Surprise Me, via applyEdit's "always" effect) as opposed
  // to a mere geometry edit or an explicit Regenerate click, so a freshly
  // loaded non-flat system always gets resetFourDView()'s "fresh visit"
  // treatment even when the PREVIOUS system was already non-flat too (e.g.
  // switching from the double-rotation spiral straight to the pentatope).
  function regenerate(replaced = false): void {
    const nonFlat = systemIsNonFlat(state);
    const wasNonFlat = viewIs4D;
    viewIs4D = nonFlat;
    if (nonFlat !== wasNonFlat) {
      scene.setFourDActive(nonFlat);
      // Re-gate the panel on the flip. Most regenerate() callers refresh the
      // UI themselves right after (applyEdit, boot), but the per-slider
      // geometry path (onTransformGeometry / onFinalTransformGeometry)
      // deliberately does not — and since the 4D editor group (fr-bf6.3) a
      // w-slider drag is a geometry edit that CAN flip flatness. Without this,
      // the cloud switches projection while flame/solid/4D-view sections sit
      // stale until the next unrelated interaction. Harmlessly idempotent for
      // the callers that refresh anyway.
      ui.updateLabels(state);
    }

    if (nonFlat && (replaced || !wasNonFlat)) {
      resetFourDView();
    } else if (!nonFlat && wasNonFlat) {
      // scene.setFourDActive(false) (just above) restores the 3D material/
      // fog/background, but does NOT touch the scaffold — a separate scene
      // object that otherwise keeps tumbling over the 3D cloud forever.
      scene.setFourDScaffold(null);
    }

    // 4D projection path: run the 4D chaos game and upload the projected xyz +
    // separate w. Leaves `lastResult` (the 3D cloud) untouched so a later
    // flat edit restores the 3D path cleanly; color lives in the shader, so
    // there is no color buffer to build here.
    if (nonFlat) {
      const transforms4 = state.transforms.map(toTransform4);
      const final4 = state.finalTransform
        ? toTransform4(state.finalTransform)
        : null;
      fourDResult = runChaosGame4(
        transforms4,
        state.numPoints,
        Math.random,
        final4,
      );
      const b4 = fourDResult.bounds;
      scene.setPoints4(
        fourDResult.positions,
        fourDResult.w,
        fourDResult.center,
        fourDResult.radius,
        [
          (b4.maxX - b4.minX) / 2,
          (b4.maxY - b4.minY) / 2,
          (b4.maxZ - b4.minZ) / 2,
          (b4.maxW - b4.minW) / 2,
        ],
      );
      ui.setPointCount(fourDResult.count);
      return;
    }
    lastResult = runChaosGame(
      state.transforms,
      state.numPoints,
      Math.random,
      state.finalTransform ?? null,
      state.symmetry,
    );
    const colors = buildColors(
      lastResult,
      state.transforms,
      state.colorMode,
      state.colorGamma,
    );
    scene.setPoints(lastResult.positions, colors);
    ui.setPointCount(lastResult.count);
  }

  // Rebuild only the color buffer over the cached cloud and push it to the
  // scene. Leaves positions (and thus the RNG) untouched, so switching color
  // mode recolors the same shape instantly. No-op before the first generation.
  function recolor(): void {
    // In 4D the point color is computed in the shader from the rotated w, so
    // there is no CPU color buffer to rebuild.
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

  // Auto-fit the camera to a freshly-generated attractor (fr-0b8): a
  // whole-system replacement (preset load / Surprise Me) can leave the
  // previous camera pointed at empty space or buried inside the new cloud,
  // so glide target/radius to frame it instead of leaving first impressions
  // to luck. theta/phi are left untouched — only the distance and the point
  // being orbited move, so the fractal swaps in place and the camera glides
  // to meet it. Never triggered by Regenerate or a geometry edit (those
  // would fight the user's own framing) — call sites are onPreset/onSurprise
  // below, right after `applyEdit`'s synchronous regenerate lands a fresh
  // `lastResult`/`fourDResult`.
  interface CameraTween {
    startMs: number;
    fromRadius: number;
    toRadius: number;
    fromTarget: Vec3;
    toTarget: Vec3;
  }
  const CAMERA_TWEEN_MS = 600;
  let cameraTween: CameraTween | null = null;

  // The bounds-consuming core of the auto-fit, shared by the 3D path (below,
  // passing lastResult.bounds) and fitCameraToAttractor's 4D branch (passing a
  // synthesized box — see fourDFramingBounds).
  function fitCameraToBounds(bounds: Bounds): void {
    const toTarget = boundsCenter(bounds);
    const toRadius = fitRadius(
      bounds,
      (scene.camera.fov * Math.PI) / 180,
      scene.camera.aspect,
    );
    if (prefersReducedMotion()) {
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

  function fitCameraToAttractor(): void {
    if (viewIs4D) {
      // radius is rotation-invariant, so framing the synthesized box once
      // holds at every tumble angle (see fourDFramingBounds/fitCameraToBounds).
      if (fourDResult) {
        fitCameraToBounds(
          fourDFramingBounds(fourDResult.center, fourDResult.radius),
        );
      }
      return;
    }
    if (!lastResult) return;
    fitCameraToBounds(lastResult.bounds);
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
      // Device-aware memory budget for the supersampled accumulator (fr-7c8).
      // Computed here because its inputs — deviceMemory (Chromium-only,
      // hence the cast; absent from TS's DOM lib) and pointer coarseness —
      // are main-thread/window facilities a worker can't reliably read.
      maxAccumBuckets: flameAccumBudgetBuckets(
        (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
        window.matchMedia("(pointer: coarse)").matches,
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

  // Session-only undo/redo over encoded scene snapshots (see history.ts).
  const history = new SceneHistory();
  // True while the CURRENT edit burst already has a checkpoint — the 300 ms
  // save debounce below defines "one burst", so a slider drag coalesces into
  // a single undo step instead of one per tick.
  let burstOpen = false;

  // Debounced saver — persists 300 ms after the last scene-affecting change so
  // rapid slider drags don't flood history/storage on every tick.
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  function scheduleSave(): void {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveScene(toSnapshot(state));
      burstOpen = false;
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
    burstOpen = false;
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushSave();
  });
  window.addEventListener("pagehide", flushSave);

  /**
   * Bookkeeping for a scene-document edit that is ABOUT to happen: capture an
   * undo checkpoint of the PRE-edit state on the leading edge of an edit
   * burst, and schedule the trailing-edge debounced save. Must be called
   * BEFORE the state mutation. The 300 ms save debounce defines "one burst",
   * so a slider drag coalesces into a single undo step. "replace" (preset
   * load / Surprise Me) always cuts a fresh checkpoint, even mid-burst, and
   * tags the transition so undo/redo re-frames the camera when crossing it.
   *
   * Every handler that edits the persisted scene document must route its save
   * through here (this is what used to be a bare scheduleSave() call at the
   * end of each handler); scheduleSave() alone is only for paths that must
   * not create an undo step (the undo/redo restore itself).
   */
  function beginSceneEdit(kind: "tweak" | "replace" = "tweak"): void {
    if (!burstOpen || kind === "replace") {
      history.checkpoint(encodeScene(toSnapshot(state)), kind === "replace");
      burstOpen = true;
      syncUndoUi();
    }
    scheduleSave();
  }

  function syncUndoUi(): void {
    ui.setUndoRedo(history.canUndo, history.canRedo);
  }

  /**
   * Apply a history snapshot: whole-system-replacement semantics, the same path
   * a boot-time hash/localStorage load takes. Any active flame/solid render is
   * exited first (they are session-only overlays OF the document; the app
   * "boots into the explorer" and so does time travel). View state stays live
   * except where the restored document invalidates it: the selection is
   * clamped/cleared exactly like removeTransform does, and the preset scaffold
   * is cleared (preset-load decoration, not document state). `refit` re-frames
   * the camera only when the step crosses a whole-system replacement —
   * symmetric with how the camera moved when that replacement was applied;
   * ordinary parameter edits leave the user's framing alone.
   */
  function restoreSnapshot(snapshot: string, refit: boolean): void {
    const snap = decodeScene(snapshot);
    if (!snap) return; // can't happen: entries are encodeScene output
    if (state.flameActive) exitFlameMode();
    if (state.solidActive) exitSolidMode();
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
    regenerate(true);
    scene.setFourDScaffold(null);
    scene.setRenderStyle(state.renderStyle);
    // Mirror onRenderStyle: never leave a stale glow exposure on a non-glow style.
    if (state.renderStyle !== "glow") scene.setGlowExposure(1);
    scene.setPointSize(state.pointSize);
    scene.setGuidesVisible(state.showGuides);
    scene.setSolidParams(state.solid);
    refreshGuides();
    refreshUi();
    if (refit) fitCameraToAttractor();
    // Persist the restored document WITHOUT opening an undo burst: an undo is
    // not an edit (it must not checkpoint), so this is the one legitimate bare
    // scheduleSave outside beginSceneEdit.
    scheduleSave();
  }

  function performUndo(): void {
    // Settle an in-progress burst so it becomes its own undo step before we
    // step behind it (mirrors flushSave's page-hide contract).
    if (burstOpen) flushSave();
    const entry = history.undo(encodeScene(toSnapshot(state)));
    if (entry) restoreSnapshot(entry.snapshot, entry.replaced);
    syncUndoUi();
  }

  function performRedo(): void {
    if (burstOpen) flushSave();
    const entry = history.redo(encodeScene(toSnapshot(state)));
    if (entry) restoreSnapshot(entry.snapshot, entry.replaced);
    syncUndoUi();
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
   * even switching directly between two non-flat presets.
   *
   * regenerate() runs BEFORE refreshGuides()/refreshUi() (not after, as the
   * names might suggest) — deliberately: regenerate() is the only place that
   * updates `viewIs4D`, and refreshGuides() reads it to decide whether to
   * show guide boxes at all. Refreshing guides first would read the flatness
   * of the PREVIOUS system for one tick — invisible for an ordinary 3D edit,
   * but a freshly-loaded preset that flips flatness (in either direction)
   * would flash the wrong guide state (or, before fr-bf6, this could never
   * happen: a preset/Surprise-Me load was guarded out entirely while
   * `fourDActive`).
   *
   * Before applying the reducer, checkpoints an undo step and, after it, every
   * geometry edit refreshes the guide boxes and the UI, then schedules a
   * debounced save (see `beginSceneEdit`).
   */
  function applyEdit(
    applyReducer: () => void,
    effect: "auto" | "always" = "auto",
  ): void {
    beginSceneEdit(effect === "always" ? "replace" : "tweak");
    applyReducer();
    if (effect === "always" || state.autoUpdate) {
      regenerate(effect === "always");
    }
    refreshGuides();
    refreshUi();
  }

  // Only a handful of handlers below still guard on the view being 4D — the
  // ones whose controls are hidden while it is (flame/solid entry, symmetry,
  // color mode/contrast, depth style — see ui.ts's updateLabels), kept
  // belt-and-braces so a stray call can't mutate a 3D-only concern that isn't
  // even on screen. Everything that edits the system, loads a preset/
  // Surprise-Me system, or selects a transform is UNGUARDED (fr-bf6): the
  // single editor and transform list are live for a non-flat system exactly
  // like a flat one.
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
    onUndo: () => performUndo(),
    onRedo: () => performRedo(),
    onPreset: (preset) => {
      applyEdit(() => {
        state = setTransforms(state, presetTransforms(preset));
      }, "always");
      // The tumbling scaffold (Show guides toggles it with the grid/axes) —
      // only `pentatope` carries one; every other preset (flat or non-flat)
      // clears whatever the previous preset left behind.
      scene.setFourDScaffold(PRESET_SCAFFOLDS[preset]?.() ?? null);
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
      // randomSystem never rolls a `w` extension, but a preset scaffold from
      // an earlier visit could still be showing — clear it unconditionally.
      scene.setFourDScaffold(null);
      fitCameraToAttractor();
    },
    onNumPointsInput: (value) => {
      beginSceneEdit();
      state = setNumPoints(state, value);
      ui.updateLabels(state);
    },
    onPointSizeInput: (value) => {
      beginSceneEdit();
      state = setPointSize(state, value);
      scene.setPointSize(value);
      ui.updateLabels(state);
    },
    onGlowBrightnessInput: (value) => {
      beginSceneEdit();
      // No direct scene push needed: animate()'s per-frame glow-exposure
      // calculation already reads state.glowBrightness as a multiplier.
      state = setGlowBrightness(state, value);
      ui.updateLabels(state);
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
      beginSceneEdit();
      state = setShowGuides(state, checked);
      scene.setGuidesVisible(checked);
      refreshUi();
    },
    onColorMode: (mode) => {
      // colorModeRow hides while non-flat (the shader colors from the rotated
      // w instead) — belt-and-braces.
      if (viewIs4D) return;
      beginSceneEdit();
      state = setColorMode(state, mode);
      // The color-contrast row's visibility (fr-8sk) depends on colorMode —
      // same rationale as onRenderStyle's updateLabels call below for the
      // glow-brightness row.
      ui.updateLabels(state);
      recolor();
    },
    onColorGammaInput: (value) => {
      if (viewIs4D) return;
      beginSceneEdit();
      state = setColorGamma(state, value);
      ui.updateLabels(state);
      recolor();
    },
    onRenderStyle: (style) => {
      // renderStyleRow hides while non-flat (the 4D material/render path
      // ignores renderStyle entirely) — belt-and-braces.
      if (viewIs4D) return;
      beginSceneEdit();
      state = setRenderStyle(state, style);
      scene.setRenderStyle(style);
      // Reset glow exposure so no stale factor sticks when switching away.
      if (style !== "glow") scene.setGlowExposure(1);
      // Refresh labels so the glow-brightness row (fr-8b1) shows/hides
      // immediately — previously nothing in this handler depended on
      // renderStyle-conditional DOM, so the sync was never needed here.
      ui.updateLabels(state);
    },
    onToggleAutoUpdate: (checked) => {
      state = setAutoUpdate(state, checked);
    },
    onSymmetryOrderInput: (value) => {
      // symmetrySection hides while non-flat (the 4D chaos game has no
      // symmetry parameter at all) — belt-and-braces.
      if (viewIs4D) return;
      beginSceneEdit();
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
    },
    onSymmetryAxisChange: (axis) => {
      if (viewIs4D) return;
      beginSceneEdit();
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
    },
    onSelect: (index) => {
      state = selectTransform(state, index);
      refreshGuides();
      refreshUi();
    },
    onTransformGeometry: (index, geometry) => {
      beginSceneEdit();
      state = updateTransform(state, index, geometry);
      scene.setGuideGeometry(index, geometry);
      ui.renderTransformList(
        state.transforms,
        state.selectedTransform,
        state.finalTransform ?? null,
      );
      if (state.autoUpdate) regenerate();
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
      beginSceneEdit();
      state = setFinalTransform(state, { id: 0, ...geometry });
      ui.renderTransformList(
        state.transforms,
        state.selectedTransform,
        state.finalTransform ?? null,
      );
      if (state.autoUpdate) regenerate();
    },
    onTogglePanel: () => {
      state = setPanelOpen(state, !state.panelOpen);
      ui.updateLabels(state);
    },
    onClosePanel: () => {
      state = setPanelOpen(state, false);
      ui.updateLabels(state);
    },
    onEnterFlameRender: () => {
      // flameEntry hides while non-flat — belt-and-braces.
      if (viewIs4D) return;
      enterFlameMode();
    },
    onExitFlameRender: () => exitFlameMode(),
    onFlameExposureInput: (value) => {
      beginSceneEdit();
      state = setFlameExposure(state, value);
      ui.updateLabels(state);
      // Shared mode: the tone-map runs on THIS thread over the live shared
      // buckets, so the change lands instantly — even mid-chunk, when the
      // worker couldn't service a command anyway. Transfer mode: the worker
      // owns the tone-map; forward as before. Same split for gamma/vibrancy.
      if (flameShared) presentSharedFrame();
      else postFlame({ type: "setExposure", exposure: state.flame.exposure });
    },
    onFlameIterationsInput: (value) => {
      beginSceneEdit();
      state = setFlameIterations(state, value);
      ui.updateLabels(state);
      postFlame({
        type: "setIterationsBudget",
        iterations: state.flame.iterations,
      });
    },
    onFlameGammaInput: (value) => {
      beginSceneEdit();
      state = setFlameGamma(state, value);
      ui.updateLabels(state);
      if (flameShared) presentSharedFrame();
      else postFlame({ type: "setGamma", gamma: state.flame.gamma });
    },
    onFlameVibrancyInput: (value) => {
      beginSceneEdit();
      state = setFlameVibrancy(state, value);
      ui.updateLabels(state);
      if (flameShared) presentSharedFrame();
      else postFlame({ type: "setVibrancy", vibrancy: state.flame.vibrancy });
    },
    onFlameSupersampleInput: (value) => {
      beginSceneEdit();
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
    },
    onFlamePaletteChange: (paletteId) => {
      beginSceneEdit();
      // Like supersample this restarts accumulation in the worker (the color
      // sums bake in the palette); the worker owns that restart, so this just
      // updates state + label and forwards the new palette.
      state = setFlamePaletteId(state, paletteId);
      ui.updateLabels(state);
      postFlame({ type: "setPalette", paletteId: state.flame.paletteId });
    },
    onFlameEstimatorRadiusInput: (value) => {
      beginSceneEdit();
      state = setFlameEstimatorRadius(state, value);
      ui.updateLabels(state);
      postFlame({
        type: "setEstimatorRadius",
        estimatorRadius: state.flame.estimatorRadius,
      });
    },
    onFlameEstimatorMinimumRadiusInput: (value) => {
      beginSceneEdit();
      state = setFlameEstimatorMinimumRadius(state, value);
      ui.updateLabels(state);
      postFlame({
        type: "setEstimatorMinimumRadius",
        estimatorMinimumRadius: state.flame.estimatorMinimumRadius,
      });
    },
    onFlameEstimatorCurveInput: (value) => {
      beginSceneEdit();
      state = setFlameEstimatorCurve(state, value);
      ui.updateLabels(state);
      postFlame({
        type: "setEstimatorCurve",
        estimatorCurve: state.flame.estimatorCurve,
      });
    },
    onEnterSolidRender: () => {
      // solidEntry hides while non-flat — belt-and-braces.
      if (viewIs4D) return;
      enterSolidMode();
    },
    onExitSolidRender: () => exitSolidMode(),
    onSolidThresholdInput: (value) => {
      beginSceneEdit();
      state = setSolidThreshold(state, value);
      ui.updateLabels(state);
      scene.setSolidParams(state.solid);
    },
    onSolidLightAzimuthInput: (value) => {
      beginSceneEdit();
      state = setSolidLightAzimuth(state, value);
      ui.updateLabels(state);
      scene.setSolidParams(state.solid);
    },
    onSolidLightElevationInput: (value) => {
      beginSceneEdit();
      state = setSolidLightElevation(state, value);
      ui.updateLabels(state);
      scene.setSolidParams(state.solid);
    },
    onSolidAmbientInput: (value) => {
      beginSceneEdit();
      state = setSolidAmbient(state, value);
      ui.updateLabels(state);
      scene.setSolidParams(state.solid);
    },
    onSolidPaletteChange: (paletteId) => {
      beginSceneEdit();
      // Like resolution this restarts accumulation in the worker (the
      // colors bake into avgRGB); the worker owns that restart, so this
      // just updates state + label and forwards the new palette.
      state = setSolidPaletteId(state, paletteId);
      ui.updateLabels(state);
      postVoxel({ type: "setPalette", paletteId: state.solid.paletteId });
    },
    onSolidIterationsInput: (value) => {
      beginSceneEdit();
      state = setSolidIterations(state, value);
      ui.updateLabels(state);
      postVoxel({
        type: "setIterationsBudget",
        iterations: state.solid.iterations,
      });
    },
    onSolidResolutionInput: (value) => {
      beginSceneEdit();
      // The reducer clamps/snaps to the voxel step; unlike the flame's
      // supersample the worker has no live "change resolution" command (a
      // grid's dimensions are fixed at allocation), so a genuine change while
      // active restarts the whole session via enterSolidMode — a fresh
      // worker, exactly like a Render click.
      const previousResolution = state.solid.resolution;
      state = setSolidResolution(state, value);
      ui.updateLabels(state);
      if (state.solidActive && state.solid.resolution !== previousResolution) {
        enterSolidMode();
      }
    },
    // Slice state is session-only view state (like the tumble clock): it never
    // touches AppState or persistence, so these write straight to the scene.
    onFourDSliceToggle: (checked) => {
      fourDSliceOn = checked;
      scene.setFourDSlice(fourDSliceOn, fourDSliceCenter);
    },
    onFourDSliceInput: (value) => {
      fourDSliceCenter = value;
      scene.setFourDSlice(fourDSliceOn, fourDSliceCenter);
    },
    // Tumble pause/resume + speed (fr-woc): also session-only view state, no
    // scheduleSave — animate() reads these two vars directly every frame, so
    // there is nothing else to push here.
    onFourDTumbleToggle: (checked) => {
      fourDTumbleOn = checked;
    },
    onFourDTumbleSpeedInput: (value) => {
      fourDTumbleSpeed = value;
    },
  });

  attachInteractions(scene, orbit, {
    selectedTransform: selectedBox,
    frozen: () => state.flameActive,
    onTransformChange: (index, geometry) => {
      beginSceneEdit();
      state = updateTransform(state, index, geometry);
      ui.renderTransformList(
        state.transforms,
        state.selectedTransform,
        state.finalTransform ?? null,
      );
      ui.renderTransformEditor(state.transforms[index], index);
      if (state.autoUpdate) regenerate();
    },
    fourDView: () => viewIs4D,
    onFourDRotate: ({ xw, yw, zw }) => {
      if (!viewIs4D) return; // belt-and-braces, same as the ui handlers
      if (xw !== 0) fourDPair = rotateInPlane(fourDPair, "xw", xw);
      if (yw !== 0) fourDPair = rotateInPlane(fourDPair, "yw", yw);
      if (zw !== 0) fourDPair = rotateInPlane(fourDPair, "zw", zw);
      // animate() pushes rotorMatrix(fourDPair) next frame; nothing else to do.
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
      if (e.shiftKey) performRedo();
      else performUndo();
    } else if (key === "y" && e.ctrlKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault();
      performRedo();
    }
  });

  const loading = document.getElementById("loading");
  if (loading) loading.style.display = "none";
  scene.setRenderStyle(state.renderStyle);
  scene.setPointSize(state.pointSize);
  // Push the restored solid threshold/lighting to the GPU uniforms: without
  // this, a scene restored with non-default solid params would render with
  // voxel-material.ts's hardcoded defaults until a solid slider first moved.
  scene.setSolidParams(state.solid);
  // regenerate() first (see applyEdit's doc comment for why): it decides
  // `viewIs4D` for a possibly-restored non-flat scene, and refreshGuides()
  // right after needs that to already be current, not defaulted to `false`.
  regenerate();
  refreshGuides();
  // Match grid/axes to the initial (possibly restored) guide visibility, since
  // refreshGuides only governs the per-transform boxes.
  scene.setGuidesVisible(state.showGuides);
  refreshUi();
  syncUndoUi();

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
    if (viewIs4D) {
      const now = performance.now();
      // Clamp dt: a backgrounded tab suspends RAF, and an unclamped catch-up
      // delta would violently snap the orientation on refocus.
      const dt = Math.min((now - fourDLastTickMs) / 1000, 0.1);
      fourDLastTickMs = now;
      if (fourDTumbleOn) {
        fourDPair = rotateInPlane(
          fourDPair,
          "xy",
          dt * FOUR_D_XY_RATE * fourDTumbleSpeed,
        );
        fourDPair = rotateInPlane(
          fourDPair,
          "zw",
          dt * FOUR_D_ZW_RATE * fourDTumbleSpeed,
        );
      }
      // Pushed every 4D frame, paused or not — 16 floats/frame is nothing and
      // it keeps one code path. fourDLastTickMs still advances while paused,
      // so resuming doesn't replay the gap as a jump. The point color
      // re-derives in-shader from the new rotation, so nothing else needs
      // updating per frame.
      scene.setRot4(rotorMatrix(fourDPair));
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

registerServiceWorker();
main();
