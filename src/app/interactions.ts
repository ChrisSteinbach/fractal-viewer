import * as THREE from "three";
import { ROTATE_SPEED } from "./orbit";
import type { OrbitCamera } from "./orbit";
import type { FractalScene } from "./scene";
import { clamp } from "../fractal/vec";
import { MIN_GUIDE_SCALE, MAX_GUIDE_SCALE } from "./constants";
import type { Vec3 } from "../fractal/types";

export interface TransformGeometry {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
}

export interface InteractionCallbacks {
  /** Current selection: a transform index, or `null` for camera mode. */
  selectedTransform: () => number | null;
  /** Called whenever a drag edits the selected transform's geometry. */
  onTransformChange: (index: number, geometry: TransformGeometry) => void;
  /**
   * True while a flame render is converging: pointer/wheel input is ignored
   * so the frozen camera (and the transforms it is rendering) can't drift
   * out from under it. The listeners stay attached (see the module doc
   * comment on teardown) — this just short-circuits their effect.
   */
  frozen: () => boolean;
  /** True while the 4D projection is active: Shift retargets rotate-drags and
   * the wheel from the 3D camera to the three w-plane rotations (fr-woc). */
  fourDActive: () => boolean;
  /** A Shift-retargeted gesture turned the 4D view: plane-angle deltas in
   * radians (zero for planes the gesture doesn't touch). */
  onFourDRotate: (delta: { xw: number; yw: number; zw: number }) => void;
}

/** Radians per normalized wheel px that Shift+scroll turns the ZW plane
 * (fr-woc) — one ~100 px notch (after `deltaMode` normalization) reaches
 * roughly 0.15 rad before clamping, matching the drag gesture's feel. */
const FOUR_D_WHEEL_SPEED = 0.0025;
/** Per-event clamp on the Shift+scroll ZW turn: a single coarse notch steps
 * ~8.6°, while a trackpad's stream of small deltas stays smooth. */
const FOUR_D_WHEEL_MAX = 0.15;

type OrbitMode = "none" | "rotate" | "pan" | "dolly-pan";

function touchOf(event: Event): TouchEvent | null {
  return "touches" in event ? (event as TouchEvent) : null;
}

function pointerXY(event: Event): { x: number; y: number } {
  const touch = touchOf(event);
  if (touch && touch.touches.length > 0) {
    return { x: touch.touches[0].clientX, y: touch.touches[0].clientY };
  }
  const mouse = event as MouseEvent;
  return { x: mouse.clientX, y: mouse.clientY };
}

function pinchSpan(event: TouchEvent): { dist: number; angle: number } {
  const dx = event.touches[1].clientX - event.touches[0].clientX;
  const dy = event.touches[1].clientY - event.touches[0].clientY;
  return { dist: Math.hypot(dx, dy), angle: Math.atan2(dy, dx) };
}

function pinchCenter(event: TouchEvent): { x: number; y: number } {
  return {
    x: (event.touches[0].clientX + event.touches[1].clientX) / 2,
    y: (event.touches[0].clientY + event.touches[1].clientY) / 2,
  };
}

/**
 * Wire mouse, touch, and wheel input to the scene. In camera mode the gestures
 * orbit/pan/zoom the {@link OrbitCamera}; with a transform selected they move,
 * rotate, and scale its guide box, reporting edits via
 * {@link InteractionCallbacks.onTransformChange}. While
 * {@link InteractionCallbacks.frozen} is true (a flame render is converging),
 * every gesture is ignored so the camera it was frozen at cannot drift.
 *
 * Listeners are attached for the page lifetime — correct for this
 * single-instance SPA; there is no teardown path.
 */
export function attachInteractions(
  scene: FractalScene,
  orbit: OrbitCamera,
  callbacks: InteractionCallbacks,
): void {
  const canvas = scene.canvas;
  const camera = scene.camera;
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const dragPlane = new THREE.Plane();
  const dragOffset = new THREE.Vector3();

  let orbitMode: OrbitMode = "none";
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let dollyStart = 0;
  let panStartX = 0;
  let panStartY = 0;
  let pinchDist = 0;
  let pinchAngle = 0;

  function setNdc(clientX: number, clientY: number): void {
    const rect = canvas.getBoundingClientRect();
    ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  }

  // Screen-space pan: shift the orbit target along the camera's right/up axes,
  // scaled so a drag tracks the cursor at the target's depth.
  function panByScreen(dx: number, dy: number): void {
    camera.updateMatrixWorld();
    const target = new THREE.Vector3(
      orbit.target[0],
      orbit.target[1],
      orbit.target[2],
    );
    const dist =
      camera.position.distanceTo(target) *
      Math.tan(((camera.fov / 2) * Math.PI) / 180);
    const right = new THREE.Vector3().setFromMatrixColumn(
      camera.matrixWorld,
      0,
    );
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    right.multiplyScalar((-dx * dist) / window.innerHeight / 2);
    up.multiplyScalar((dy * dist) / window.innerHeight / 2);
    orbit.panBy(right.x + up.x, right.y + up.y, right.z + up.z);
  }

  function commit(index: number, cube: THREE.Object3D): void {
    callbacks.onTransformChange(index, {
      position: [cube.position.x, cube.position.y, cube.position.z],
      rotation: [cube.rotation.x, cube.rotation.y, cube.rotation.z],
      scale: [cube.scale.x, cube.scale.y, cube.scale.z],
    });
  }

  function beginCameraGesture(event: Event): void {
    const touch = touchOf(event);
    if (touch && touch.touches.length === 2) {
      dollyStart = pinchSpan(touch).dist;
      const center = pinchCenter(touch);
      panStartX = center.x;
      panStartY = center.y;
      orbitMode = "dolly-pan";
      return;
    }
    const mouse = touch ? null : (event as MouseEvent);
    orbitMode = mouse && mouse.button === 2 ? "pan" : "rotate";
  }

  function beginTransformGesture(event: Event, index: number): void {
    dragging = true;
    const cube = scene.guideCube(index);
    const touch = touchOf(event);
    if (touch && touch.touches.length === 2) {
      const span = pinchSpan(touch);
      pinchDist = span.dist;
      pinchAngle = span.angle;
      return;
    }
    if (!cube) return;
    const normal = new THREE.Vector3();
    camera.getWorldDirection(normal);
    dragPlane.setFromNormalAndCoplanarPoint(normal, cube.position);
    raycaster.setFromCamera(ndc, camera);
    const hit = new THREE.Vector3();
    raycaster.ray.intersectPlane(dragPlane, hit);
    dragOffset.copy(cube.position).sub(hit);
  }

  function onPointerDown(event: Event): void {
    if (callbacks.frozen()) return;
    const { x, y } = pointerXY(event);
    setNdc(x, y);
    lastX = x;
    lastY = y;

    const selected = callbacks.selectedTransform();
    if (selected === null) {
      beginCameraGesture(event);
      return;
    }
    event.preventDefault();
    beginTransformGesture(event, selected);
  }

  function moveCamera(event: Event, dx: number, dy: number): void {
    if (orbitMode === "rotate") {
      // Checked per-move (not latched at pointerdown), so pressing/releasing
      // Shift mid-drag switches live between orbiting and w-turning — both
      // are incremental deltas, so there is no jump on the switch. Touch
      // events have no shiftKey, so touch always orbits (mobile drives the
      // w-planes via the per-map sliders instead — see index.html).
      const mouse = touchOf(event) ? null : (event as MouseEvent);
      if (callbacks.fourDActive() && mouse?.shiftKey) {
        // Dragging toward +screen-x rolls the world +x axis into +w; screen y
        // points down while world y points up, hence the dy negation for yw
        // (a feel default — each sign is trivially negatable).
        callbacks.onFourDRotate({
          xw: dx * ROTATE_SPEED,
          yw: -dy * ROTATE_SPEED,
          zw: 0,
        });
        return;
      }
      orbit.rotate(dx, dy);
    } else if (orbitMode === "pan") {
      panByScreen(dx, dy);
    } else if (orbitMode === "dolly-pan") {
      const touch = touchOf(event);
      if (!touch || touch.touches.length !== 2) return;
      const { dist } = pinchSpan(touch);
      if (dist > 0) orbit.dolly(dollyStart / dist);
      dollyStart = dist;
      const center = pinchCenter(touch);
      panByScreen(center.x - panStartX, center.y - panStartY);
      panStartX = center.x;
      panStartY = center.y;
    }
  }

  function moveTransform(
    event: Event,
    index: number,
    dx: number,
    dy: number,
  ): void {
    const cube = scene.guideCube(index);
    if (!cube) return;
    const touch = touchOf(event);
    const mouse = touch ? null : (event as MouseEvent);

    if (touch && touch.touches.length === 2) {
      const span = pinchSpan(touch);
      const factor = pinchDist === 0 ? 1 : span.dist / pinchDist;
      cube.scale.setScalar(
        clamp(cube.scale.x * factor, MIN_GUIDE_SCALE, MAX_GUIDE_SCALE),
      );
      cube.rotation.y += span.angle - pinchAngle;
      pinchDist = span.dist;
      pinchAngle = span.angle;
    } else if (mouse && mouse.buttons === 2) {
      cube.rotation.y += dx * ROTATE_SPEED;
      cube.rotation.x += dy * ROTATE_SPEED;
    } else {
      const point = pointerXY(event);
      setNdc(point.x, point.y);
      raycaster.setFromCamera(ndc, camera);
      const hit = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(dragPlane, hit)) return;
      cube.position.copy(hit.add(dragOffset));
    }
    commit(index, cube);
  }

  function onPointerMove(event: Event): void {
    if (callbacks.frozen()) return;
    const { x, y } = pointerXY(event);
    const dx = x - lastX;
    const dy = y - lastY;
    const selected = callbacks.selectedTransform();

    if (selected === null) {
      moveCamera(event, dx, dy);
    } else if (dragging) {
      event.preventDefault();
      moveTransform(event, selected, dx, dy);
    }
    lastX = x;
    lastY = y;
  }

  function onPointerUp(): void {
    dragging = false;
    orbitMode = "none";
  }

  function onWheel(event: WheelEvent): void {
    event.preventDefault();
    if (callbacks.frozen()) return;
    const selected = callbacks.selectedTransform();
    if (selected === null) {
      if (callbacks.fourDActive() && event.shiftKey) {
        // Chrome (Win/Linux) remaps Shift+vertical-wheel to deltaX — read
        // whichever axis moved.
        const raw = event.deltaY !== 0 ? event.deltaY : event.deltaX;
        // Normalize deltaMode (Firefox reports lines): 1 = lines (~16 px), 2 =
        // pages (~120 px).
        const px =
          event.deltaMode === 1
            ? raw * 16
            : event.deltaMode === 2
              ? raw * 120
              : raw;
        // Scroll-up rolls +z into +w, the same "push into w" convention as
        // the drag's xw/yw.
        callbacks.onFourDRotate({
          xw: 0,
          yw: 0,
          zw: clamp(
            -px * FOUR_D_WHEEL_SPEED,
            -FOUR_D_WHEEL_MAX,
            FOUR_D_WHEEL_MAX,
          ),
        });
        return;
      }
      orbit.dolly(event.deltaY > 0 ? 1.1 : 0.9);
      return;
    }
    const cube = scene.guideCube(selected);
    if (!cube) return;
    const factor = event.deltaY > 0 ? 0.95 : 1.05;
    cube.scale.setScalar(
      clamp(cube.scale.x * factor, MIN_GUIDE_SCALE, MAX_GUIDE_SCALE),
    );
    commit(selected, cube);
  }

  function onContextMenu(event: Event): void {
    event.preventDefault();
  }

  canvas.addEventListener("mousedown", onPointerDown);
  canvas.addEventListener("touchstart", onPointerDown, { passive: false });
  document.addEventListener("mousemove", onPointerMove);
  document.addEventListener("touchmove", onPointerMove, { passive: false });
  document.addEventListener("mouseup", onPointerUp);
  document.addEventListener("touchend", onPointerUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("contextmenu", onContextMenu);
}
