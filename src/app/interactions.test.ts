// @vitest-environment jsdom
import * as THREE from "three";
import {
  attachInteractions,
  canvasTransformGuidesEnabled,
  canvasTransformTarget,
  resizeGuideComponent,
} from "./interactions";
import type { InteractionsHandle } from "./interactions";
import { MIN_GUIDE_SCALE, MAX_GUIDE_SCALE } from "./constants";
import type { OrbitCamera } from "./orbit";
import type { FractalScene, PointsInteractionView } from "./scene";

describe("canvas transform applicability", () => {
  it.each([
    ["points", false, true],
    ["points", true, false],
    ["flame", false, false],
    ["flame", true, false],
    ["solid", false, false],
    ["solid", true, false],
    ["surface", false, false],
    ["surface", true, false],
  ] as const)(
    "%s / fourD=%s exposes guides only for flat Points",
    (renderMode, fourD, expected) => {
      expect(canvasTransformGuidesEnabled(renderMode, fourD)).toBe(expected);
      expect(canvasTransformTarget(renderMode, fourD, 2)).toBe(
        expected ? 2 : null,
      );
    },
  );

  it.each([null, "final"] as const)(
    "maps the %s panel target to no canvas box even in flat Points",
    (selected) => {
      expect(canvasTransformTarget("points", false, selected)).toBeNull();
    },
  );
});

describe("resizeGuideComponent", () => {
  it("multiplies a positive component by the factor", () => {
    expect(resizeGuideComponent(0.5, 1.05)).toBeCloseTo(0.525);
  });

  it("preserves a mirrored (negative) component's sign", () => {
    expect(resizeGuideComponent(-0.5, 1.05)).toBeCloseTo(-0.525);
  });

  it("clamps the grown magnitude to the guide ceiling on both signs", () => {
    expect(resizeGuideComponent(1.95, 1.2)).toBe(MAX_GUIDE_SCALE);
    expect(resizeGuideComponent(-1.95, 1.2)).toBe(-MAX_GUIDE_SCALE);
  });

  it("clamps the shrunk magnitude to the guide floor on both signs", () => {
    expect(resizeGuideComponent(0.06, 0.5)).toBe(MIN_GUIDE_SCALE);
    expect(resizeGuideComponent(-0.06, 0.5)).toBe(-MIN_GUIDE_SCALE);
  });

  it("grows a zero component to the positive floor", () => {
    expect(resizeGuideComponent(0, 1.05)).toBe(MIN_GUIDE_SCALE);
  });
});

/** attachInteractions against a minimal scene. Tests that exercise transform
 * geometry can provide guide cubes; camera-only tests retain the null guide.
 * Listeners attach for the page lifetime by design; each call gets its own
 * closure, so stacking them across tests is harmless. */
function setupInteractions(
  opts: {
    selected?: number;
    selectedTransform?: () => number | null;
    guideCube?: (index: number) => THREE.Object3D | null;
    frozen?: boolean;
    fourD?: boolean;
    sliceOn?: boolean;
    interactionView?: (
      clientX: number,
      clientY: number,
    ) => PointsInteractionView | null;
    interactionViewForKind?: (
      kind: PointsInteractionView["kind"],
    ) => PointsInteractionView | null;
  } = {},
): {
  canvas: HTMLCanvasElement;
  rotate: ReturnType<typeof vi.fn>;
  dolly: ReturnType<typeof vi.fn>;
  onFourDRotate: ReturnType<typeof vi.fn>;
  onFourDViewCommit: ReturnType<typeof vi.fn>;
  onFourDSliceNudge: ReturnType<typeof vi.fn>;
  onToggleAutoMotion: ReturnType<typeof vi.fn>;
  onTransformChange: ReturnType<typeof vi.fn>;
  onTransformCommit: ReturnType<typeof vi.fn>;
  onCameraZoom: ReturnType<typeof vi.fn>;
  handle: InteractionsHandle;
} {
  document.body.replaceChildren();
  const canvas = document.createElement("canvas");
  document.body.appendChild(canvas);
  const rotate = vi.fn();
  const spherical = { radius: 5 };
  const dolly = vi.fn((factor: number) => {
    spherical.radius *= factor;
  });
  const onFourDRotate = vi.fn();
  const onFourDViewCommit = vi.fn();
  const onFourDSliceNudge = vi.fn();
  const onToggleAutoMotion = vi.fn();
  const onTransformChange = vi.fn();
  const onTransformCommit = vi.fn();
  const onCameraZoom = vi.fn();
  const orbit = {
    target: [0, 0, 0],
    spherical,
    fov: 60,
    rotate,
    panBy: vi.fn(),
    dolly,
  } as unknown as OrbitCamera;
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.z = 5;
  camera.updateMatrixWorld();
  const handle = attachInteractions(
    {
      canvas,
      camera,
      guideCube: opts.guideCube ?? (() => null),
      pointsInteractionView: opts.interactionView,
      pointsInteractionViewForKind: opts.interactionViewForKind,
    } as unknown as FractalScene,
    orbit,
    {
      selectedTransform:
        opts.selectedTransform ?? (() => opts.selected ?? null),
      onTransformChange,
      onTransformCommit,
      frozen: () => opts.frozen ?? false,
      fourDView: () => opts.fourD ?? false,
      onFourDRotate,
      onFourDViewCommit,
      fourDSliceOn: () => opts.sliceOn ?? false,
      onFourDSliceNudge,
      onToggleAutoMotion,
      onCameraZoom,
    },
  );
  return {
    canvas,
    rotate,
    dolly,
    onFourDRotate,
    onFourDViewCommit,
    onFourDSliceNudge,
    onToggleAutoMotion,
    onTransformChange,
    onTransformCommit,
    onCameraZoom,
    handle,
  };
}

// jsdom has no TouchEvent constructor; the handlers only read `touches` off
// the event, so a generic Event with the list assigned behaves identically.
function touchEvent(
  type: string,
  touches: { clientX: number; clientY: number }[],
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { touches });
  return event;
}

function fixedAxisView(
  axis: "x" | "y" | "z",
  adjustable = false,
  parallel = false,
): PointsInteractionView {
  const halfHeight = 10 * Math.tan(THREE.MathUtils.degToRad(25));
  const camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = parallel
    ? new THREE.OrthographicCamera(
        (-halfHeight * 4) / 3,
        (halfHeight * 4) / 3,
        halfHeight,
        -halfHeight,
        0.1,
        100,
      )
    : new THREE.PerspectiveCamera(50, 4 / 3, 0.1, 100);
  if (axis === "x") camera.position.set(10, 0, 0);
  else if (axis === "y") {
    camera.position.set(0, 10, 0);
    camera.up.set(0, 0, -1);
  } else camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return {
    kind: adjustable ? "current" : axis,
    camera,
    rect: { left: 0, top: 0, width: 400, height: 300 },
    adjustable,
  };
}

describe("attachInteractions Points view routing", () => {
  it.each([
    ["x", 0, false],
    ["y", 1, false],
    ["z", 2, false],
    ["x", 0, true],
    ["y", 1, true],
    ["z", 2, true],
  ] as const)(
    "moves in the %s pane's image plane while preserving component %i (parallel=%s)",
    (axis, fixedComponent, parallel) => {
      const cube = new THREE.Object3D();
      cube.position.set(1, 2, 3);
      const { canvas, onTransformChange } = setupInteractions({
        selected: 0,
        guideCube: () => cube,
        interactionView: () => fixedAxisView(axis, false, parallel),
      });

      canvas.dispatchEvent(
        new MouseEvent("mousedown", {
          button: 0,
          buttons: 1,
          clientX: 200,
          clientY: 150,
        }),
      );
      document.dispatchEvent(
        new MouseEvent("mousemove", {
          buttons: 1,
          clientX: 250,
          clientY: 185,
        }),
      );
      document.dispatchEvent(new MouseEvent("mouseup"));

      expect(onTransformChange).toHaveBeenCalled();
      const geometry = onTransformChange.mock.lastCall?.[1];
      expect(geometry?.position[fixedComponent]).toBeCloseTo(
        [1, 2, 3][fixedComponent],
      );
      expect(geometry?.position).not.toEqual([1, 2, 3]);
    },
  );

  it("keeps camera gestures in Current and leaves fixed panes axis-locked", () => {
    let current = false;
    const fixed = fixedAxisView("x");
    const adjustable = fixedAxisView("z", true);
    const { canvas, rotate, dolly } = setupInteractions({
      interactionView: () => (current ? adjustable : fixed),
    });

    canvas.dispatchEvent(
      new MouseEvent("mousedown", {
        button: 0,
        buttons: 1,
        clientX: 100,
        clientY: 100,
      }),
    );
    document.dispatchEvent(
      new MouseEvent("mousemove", {
        buttons: 1,
        clientX: 130,
        clientY: 120,
      }),
    );
    document.dispatchEvent(new MouseEvent("mouseup"));
    canvas.dispatchEvent(
      new WheelEvent("wheel", { clientX: 100, clientY: 100, deltaY: 100 }),
    );
    expect(rotate).not.toHaveBeenCalled();
    expect(dolly).not.toHaveBeenCalled();

    current = true;
    canvas.dispatchEvent(
      new MouseEvent("mousedown", {
        button: 0,
        buttons: 1,
        clientX: 100,
        clientY: 100,
      }),
    );
    document.dispatchEvent(
      new MouseEvent("mousemove", {
        buttons: 1,
        clientX: 130,
        clientY: 120,
      }),
    );
    document.dispatchEvent(new MouseEvent("mouseup"));
    canvas.dispatchEvent(
      new WheelEvent("wheel", { clientX: 100, clientY: 100, deltaY: 100 }),
    );
    expect(rotate).toHaveBeenCalledWith(30, 20);
    expect(dolly).toHaveBeenCalledWith(1.1);
  });

  it("latches the placement camera at pointerdown across a divider", () => {
    const cube = new THREE.Object3D();
    cube.position.set(1, 2, 3);
    const resolve = vi.fn(() => fixedAxisView("x"));
    const { canvas, onTransformChange } = setupInteractions({
      selected: 0,
      guideCube: () => cube,
      interactionView: resolve,
    });

    canvas.dispatchEvent(
      new MouseEvent("mousedown", {
        button: 0,
        buttons: 1,
        clientX: 390,
        clientY: 150,
      }),
    );
    document.dispatchEvent(
      new MouseEvent("mousemove", {
        buttons: 1,
        clientX: 450,
        clientY: 150,
      }),
    );
    document.dispatchEvent(new MouseEvent("mouseup"));

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(onTransformChange.mock.lastCall?.[1].position[0]).toBeCloseTo(1);
  });

  it("refreshes a latched pane's rectangle without changing its identity", () => {
    const cube = new THREE.Object3D();
    cube.position.set(1, 2, 3);
    const initial = fixedAxisView("x");
    const resized = {
      ...initial,
      // Projection changed during the drag: the live rectangle updates, but
      // this replacement camera stays dormant until the next gesture.
      camera: fixedAxisView("y", false, true).camera,
      rect: { left: 20, top: 30, width: 800, height: 500 },
    };
    const refresh = vi.fn(() => resized);
    const { canvas, onTransformChange } = setupInteractions({
      selected: 0,
      guideCube: () => cube,
      interactionView: () => initial,
      interactionViewForKind: refresh,
    });

    canvas.dispatchEvent(
      new MouseEvent("mousedown", {
        button: 0,
        buttons: 1,
        clientX: 200,
        clientY: 150,
      }),
    );
    document.dispatchEvent(
      new MouseEvent("mousemove", {
        buttons: 1,
        clientX: 250,
        clientY: 185,
      }),
    );
    document.dispatchEvent(new MouseEvent("mouseup"));

    expect(refresh).toHaveBeenCalledWith("x");
    expect(onTransformChange.mock.lastCall?.[1].position[0]).toBeCloseTo(1);
  });

  it("does not let wheel routing replace an active pointer pane", () => {
    const cube = new THREE.Object3D();
    cube.position.set(1, 2, 3);
    const xView = fixedAxisView("x");
    const resolve = vi.fn(() => xView);
    const refresh = vi.fn(() => xView);
    const { canvas, onTransformChange } = setupInteractions({
      selected: 0,
      guideCube: () => cube,
      interactionView: resolve,
      interactionViewForKind: refresh,
    });

    canvas.dispatchEvent(
      new MouseEvent("mousedown", {
        button: 0,
        buttons: 1,
        clientX: 200,
        clientY: 150,
      }),
    );
    canvas.dispatchEvent(
      new WheelEvent("wheel", {
        clientX: 700,
        clientY: 450,
        deltaY: 100,
      }),
    );
    document.dispatchEvent(
      new MouseEvent("mousemove", {
        buttons: 1,
        clientX: 250,
        clientY: 185,
      }),
    );
    document.dispatchEvent(new MouseEvent("mouseup"));

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith("x");
    expect(onTransformChange.mock.lastCall?.[1].position[0]).toBeCloseTo(1);
  });
});

describe("attachInteractions mouse latch release", () => {
  it("releases the drag latch on window blur so auto-orbit can resume (focus steal mid-hold)", () => {
    const { canvas, handle } = setupInteractions();
    canvas.dispatchEvent(
      new MouseEvent("mousedown", { button: 0, clientX: 50, clientY: 50 }),
    );
    expect(handle.gestureActive()).toBe(true);

    window.dispatchEvent(new Event("blur"));

    expect(handle.gestureActive()).toBe(false);
  });

  it("keeps a normal drag latched and rotating while the button stays down", () => {
    const { canvas, rotate, handle } = setupInteractions();
    canvas.dispatchEvent(
      new MouseEvent("mousedown", { button: 0, clientX: 50, clientY: 50 }),
    );
    document.dispatchEvent(
      new MouseEvent("mousemove", { buttons: 1, clientX: 60, clientY: 55 }),
    );

    expect(rotate).toHaveBeenCalledWith(10, 5);
    expect(handle.gestureActive()).toBe(true);

    document.dispatchEvent(new MouseEvent("mouseup"));
    expect(handle.gestureActive()).toBe(false);
  });

  it("drops a latch that survived a missed mouseup instead of orbiting a button-less mouse", () => {
    const { canvas, rotate, handle } = setupInteractions();
    canvas.dispatchEvent(
      new MouseEvent("mousedown", { button: 0, clientX: 50, clientY: 50 }),
    );
    document.dispatchEvent(
      new MouseEvent("mousemove", { buttons: 0, clientX: 200, clientY: 200 }),
    );

    expect(rotate).not.toHaveBeenCalled();
    expect(handle.gestureActive()).toBe(false);
  });

  it("releases a mouse transform-drag latch on a button-less move instead of tracking the hover", () => {
    const { canvas, handle } = setupInteractions({ selected: 0 });
    canvas.dispatchEvent(
      new MouseEvent("mousedown", { button: 0, clientX: 50, clientY: 50 }),
    );
    expect(handle.gestureActive()).toBe(true);

    document.dispatchEvent(
      new MouseEvent("mousemove", { buttons: 0, clientX: 120, clientY: 90 }),
    );

    expect(handle.gestureActive()).toBe(false);
  });

  it("keeps a live touch orbit latched through a stray button-less mousemove", () => {
    const { canvas, handle } = setupInteractions();
    canvas.dispatchEvent(
      touchEvent("touchstart", [{ clientX: 50, clientY: 50 }]),
    );
    expect(handle.gestureActive()).toBe(true);

    // A touchscreen-laptop mouse (or palm brush) moves with no button down.
    document.dispatchEvent(
      new MouseEvent("mousemove", { buttons: 0, clientX: 200, clientY: 200 }),
    );

    expect(handle.gestureActive()).toBe(true);
  });
});

describe("attachInteractions transform settle commits", () => {
  function guideSetup(
    opts: {
      selectedTransform?: () => number | null;
      guideCube?: (index: number) => THREE.Object3D | null;
    } = {},
  ) {
    const cube = new THREE.Object3D();
    return {
      cube,
      ...setupInteractions({
        selected: 0,
        guideCube: opts.guideCube ?? (() => cube),
        selectedTransform: opts.selectedTransform,
      }),
    };
  }

  function beginMouseTransform(canvas: HTMLCanvasElement): void {
    canvas.dispatchEvent(
      new MouseEvent("mousedown", {
        button: 2,
        clientX: 50,
        clientY: 50,
      }),
    );
  }

  function moveMouseTransform(buttons = 2): void {
    document.dispatchEvent(
      new MouseEvent("mousemove", {
        buttons,
        clientX: 70,
        clientY: 60,
      }),
    );
  }

  it("commits a changed mouse drag exactly once on release", () => {
    const { canvas, onTransformChange, onTransformCommit } = guideSetup();
    beginMouseTransform(canvas);
    moveMouseTransform();

    expect(onTransformChange).toHaveBeenCalledTimes(1);
    expect(onTransformCommit).not.toHaveBeenCalled();
    document.dispatchEvent(new MouseEvent("mouseup"));
    document.dispatchEvent(new MouseEvent("mouseup"));

    expect(onTransformCommit).toHaveBeenCalledTimes(1);
    expect(onTransformCommit).toHaveBeenCalledWith(0);
  });

  it("does not commit a pointer gesture that made no geometry change", () => {
    const { canvas, onTransformChange, onTransformCommit } = guideSetup();
    beginMouseTransform(canvas);
    document.dispatchEvent(new MouseEvent("mouseup"));

    expect(onTransformChange).not.toHaveBeenCalled();
    expect(onTransformCommit).not.toHaveBeenCalled();
  });

  it("latches the pointer target at press time", () => {
    let selected = 0;
    const cubes = [new THREE.Object3D(), new THREE.Object3D()];
    const { canvas, onTransformChange, onTransformCommit } = guideSetup({
      selectedTransform: () => selected,
      guideCube: (index) => cubes[index] ?? null,
    });
    beginMouseTransform(canvas);
    selected = 1;
    moveMouseTransform();
    document.dispatchEvent(new MouseEvent("mouseup"));

    expect(onTransformChange).toHaveBeenCalledWith(0, expect.any(Object));
    expect(onTransformCommit).toHaveBeenCalledWith(0);
    expect(cubes[0].rotation.x).not.toBe(0);
    expect(cubes[1].rotation.x).toBe(0);
  });

  it("commits a changed touch pinch on touchend", () => {
    const { canvas, onTransformChange, onTransformCommit } = guideSetup();
    canvas.dispatchEvent(
      touchEvent("touchstart", [
        { clientX: 20, clientY: 20 },
        { clientX: 40, clientY: 20 },
      ]),
    );
    document.dispatchEvent(
      touchEvent("touchmove", [
        { clientX: 20, clientY: 20 },
        { clientX: 50, clientY: 25 },
      ]),
    );
    document.dispatchEvent(touchEvent("touchend", []));

    expect(onTransformChange).toHaveBeenCalledTimes(1);
    expect(onTransformCommit).toHaveBeenCalledTimes(1);
    expect(onTransformCommit).toHaveBeenCalledWith(0);
  });

  it("preserves target and dirty state across an additional touchstart", () => {
    let selected = 0;
    const cubes = [new THREE.Object3D(), new THREE.Object3D()];
    const { canvas, onTransformCommit } = guideSetup({
      selectedTransform: () => selected,
      guideCube: (index) => cubes[index] ?? null,
    });
    const firstSpan = [
      { clientX: 20, clientY: 20 },
      { clientX: 40, clientY: 20 },
    ];
    canvas.dispatchEvent(touchEvent("touchstart", firstSpan));
    document.dispatchEvent(
      touchEvent("touchmove", [
        { clientX: 20, clientY: 20 },
        { clientX: 55, clientY: 20 },
      ]),
    );
    selected = 1;
    canvas.dispatchEvent(touchEvent("touchstart", firstSpan));
    document.dispatchEvent(touchEvent("touchend", []));

    expect(onTransformCommit).toHaveBeenCalledTimes(1);
    expect(onTransformCommit).toHaveBeenCalledWith(0);
  });

  it("commits a dirty touch gesture when touchcancel replaces touchend", () => {
    const { canvas, onTransformCommit } = guideSetup();
    canvas.dispatchEvent(
      touchEvent("touchstart", [
        { clientX: 20, clientY: 20 },
        { clientX: 40, clientY: 20 },
      ]),
    );
    document.dispatchEvent(
      touchEvent("touchmove", [
        { clientX: 20, clientY: 20 },
        { clientX: 55, clientY: 20 },
      ]),
    );
    document.dispatchEvent(touchEvent("touchcancel", []));

    expect(onTransformCommit).toHaveBeenCalledTimes(1);
    expect(onTransformCommit).toHaveBeenCalledWith(0);
  });

  it("commits a dirty mouse gesture when the window blurs", () => {
    const { canvas, onTransformCommit } = guideSetup();
    beginMouseTransform(canvas);
    moveMouseTransform();
    window.dispatchEvent(new Event("blur"));

    expect(onTransformCommit).toHaveBeenCalledTimes(1);
    expect(onTransformCommit).toHaveBeenCalledWith(0);
  });

  it("commits on the stale buttonless-move escape only when dirty", () => {
    const dirty = guideSetup();
    beginMouseTransform(dirty.canvas);
    moveMouseTransform();
    moveMouseTransform(0);
    expect(dirty.onTransformCommit).toHaveBeenCalledTimes(1);

    const clean = guideSetup();
    beginMouseTransform(clean.canvas);
    moveMouseTransform(0);
    expect(clean.onTransformCommit).not.toHaveBeenCalled();
  });

  describe("wheel bursts", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    function wheel(canvas: HTMLCanvasElement, deltaY = -100): void {
      canvas.dispatchEvent(
        new WheelEvent("wheel", { deltaY, cancelable: true }),
      );
    }

    it("emits every notch but only one trailing commit", () => {
      const { canvas, onTransformChange, onTransformCommit } = guideSetup();
      wheel(canvas);
      vi.advanceTimersByTime(75);
      wheel(canvas);
      vi.advanceTimersByTime(75);
      wheel(canvas);

      expect(onTransformChange).toHaveBeenCalledTimes(3);
      expect(onTransformCommit).not.toHaveBeenCalled();
      vi.advanceTimersByTime(149);
      expect(onTransformCommit).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(onTransformCommit).toHaveBeenCalledTimes(1);
      expect(onTransformCommit).toHaveBeenCalledWith(0);
    });

    it("flushes the old target before starting a burst for a new target", () => {
      let selected = 0;
      const cubes = [new THREE.Object3D(), new THREE.Object3D()];
      const { canvas, onTransformChange, onTransformCommit } = guideSetup({
        selectedTransform: () => selected,
        guideCube: (index) => cubes[index] ?? null,
      });
      wheel(canvas);
      selected = 1;
      wheel(canvas);

      expect(onTransformChange).toHaveBeenNthCalledWith(
        1,
        0,
        expect.any(Object),
      );
      expect(onTransformChange).toHaveBeenNthCalledWith(
        2,
        1,
        expect.any(Object),
      );
      expect(onTransformCommit).toHaveBeenCalledTimes(1);
      expect(onTransformCommit).toHaveBeenLastCalledWith(0);
      vi.advanceTimersByTime(150);
      expect(onTransformCommit).toHaveBeenCalledTimes(2);
      expect(onTransformCommit).toHaveBeenLastCalledWith(1);
    });
  });
});

describe("attachInteractions frozen 4D view settlement", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  function key(
    canvas: HTMLCanvasElement,
    key: string,
    init: KeyboardEventInit = {},
  ): KeyboardEvent {
    const event = new KeyboardEvent("keydown", {
      key,
      cancelable: true,
      ...init,
    });
    canvas.dispatchEvent(event);
    return event;
  }

  function shiftWheel(canvas: HTMLCanvasElement, deltaY = -100): WheelEvent {
    const event = new WheelEvent("wheel", {
      deltaY,
      shiftKey: true,
      cancelable: true,
    });
    canvas.dispatchEvent(event);
    return event;
  }

  it("refuses Flame camera and transform actions", () => {
    const camera = setupInteractions({ frozen: true, fourD: true });

    camera.canvas.dispatchEvent(
      new MouseEvent("mousedown", {
        button: 0,
        clientX: 50,
        clientY: 50,
      }),
    );
    document.dispatchEvent(
      new MouseEvent("mousemove", {
        buttons: 1,
        clientX: 70,
        clientY: 60,
      }),
    );
    camera.canvas.dispatchEvent(
      new WheelEvent("wheel", { deltaY: -100, cancelable: true }),
    );
    key(camera.canvas, "ArrowLeft");
    key(camera.canvas, "+");

    expect(camera.handle.gestureActive()).toBe(false);
    expect(camera.rotate).not.toHaveBeenCalled();
    expect(camera.dolly).not.toHaveBeenCalled();
    expect(camera.onFourDRotate).not.toHaveBeenCalled();

    const cube = new THREE.Object3D();
    const transform = setupInteractions({
      selected: 0,
      guideCube: () => cube,
      frozen: true,
      fourD: true,
    });
    transform.canvas.dispatchEvent(
      new MouseEvent("mousedown", {
        button: 2,
        clientX: 50,
        clientY: 50,
      }),
    );
    document.dispatchEvent(
      new MouseEvent("mousemove", {
        buttons: 2,
        clientX: 70,
        clientY: 60,
      }),
    );
    document.dispatchEvent(new MouseEvent("mouseup"));

    expect(transform.onTransformChange).not.toHaveBeenCalled();
    expect(transform.onTransformCommit).not.toHaveBeenCalled();
  });

  it("latches a Shift-started Flame rotor drag and commits exactly once on release", () => {
    const h = setupInteractions({ frozen: true, fourD: true });
    h.canvas.dispatchEvent(
      new MouseEvent("mousedown", {
        button: 0,
        shiftKey: true,
        clientX: 50,
        clientY: 50,
      }),
    );

    // Releasing Shift mid-drag must not fall through to the frozen camera.
    document.dispatchEvent(
      new MouseEvent("mousemove", {
        buttons: 1,
        shiftKey: false,
        clientX: 70,
        clientY: 60,
      }),
    );

    expect(h.handle.gestureActive()).toBe(true);
    expect(h.onFourDRotate).toHaveBeenCalledTimes(1);
    expect(h.rotate).not.toHaveBeenCalled();
    expect(h.onFourDViewCommit).not.toHaveBeenCalled();

    document.dispatchEvent(new MouseEvent("mouseup"));
    document.dispatchEvent(new MouseEvent("mouseup"));

    expect(h.onFourDViewCommit).toHaveBeenCalledTimes(1);
  });

  it("keeps an ordinary 4D camera orbit out of the settled worker-view commit path", () => {
    const h = setupInteractions({ fourD: true });
    h.canvas.dispatchEvent(
      new MouseEvent("mousedown", {
        button: 0,
        clientX: 50,
        clientY: 50,
      }),
    );
    document.dispatchEvent(
      new MouseEvent("mousemove", {
        buttons: 1,
        clientX: 70,
        clientY: 60,
      }),
    );
    document.dispatchEvent(new MouseEvent("mouseup"));

    expect(h.rotate).toHaveBeenCalledTimes(1);
    expect(h.onFourDRotate).not.toHaveBeenCalled();
    expect(h.onFourDViewCommit).not.toHaveBeenCalled();
  });

  it("admits Shift-wheel in Flame and commits one burst after 150ms quiet", () => {
    const h = setupInteractions({ frozen: true, fourD: true });

    shiftWheel(h.canvas);
    vi.advanceTimersByTime(75);
    shiftWheel(h.canvas);

    expect(h.onFourDRotate).toHaveBeenCalledTimes(2);
    expect(h.onFourDViewCommit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(149);
    expect(h.onFourDViewCommit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(h.onFourDViewCommit).toHaveBeenCalledTimes(1);
  });

  it("admits rotor/slice keys and the visible motion preference in Flame, batching view keys once", () => {
    const h = setupInteractions({ frozen: true, fourD: true, sliceOn: true });

    const rotor = key(h.canvas, "ArrowRight", { shiftKey: true });
    vi.advanceTimersByTime(75);
    const slice = key(h.canvas, "]");
    const motion = key(h.canvas, " ");

    expect(rotor.defaultPrevented).toBe(true);
    expect(slice.defaultPrevented).toBe(true);
    expect(motion.defaultPrevented).toBe(true);
    expect(h.onFourDRotate).toHaveBeenCalledTimes(1);
    expect(h.onFourDSliceNudge).toHaveBeenCalledTimes(1);
    expect(h.onToggleAutoMotion).toHaveBeenCalledTimes(1);
    expect(h.onFourDViewCommit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(149);
    expect(h.onFourDViewCommit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(h.onFourDViewCommit).toHaveBeenCalledTimes(1);
  });
});

describe("attachInteractions camera keys", () => {
  function key(
    canvas: HTMLCanvasElement,
    key: string,
    init: KeyboardEventInit = {},
  ): KeyboardEvent {
    const event = new KeyboardEvent("keydown", {
      key,
      cancelable: true,
      ...init,
    });
    canvas.dispatchEvent(event);
    return event;
  }

  it("plain arrows orbit through the same rotate the drag uses, and consume the key", () => {
    const { canvas, rotate } = setupInteractions();
    const event = key(canvas, "ArrowRight");
    expect(rotate).toHaveBeenCalledTimes(1);
    const [dx, dy] = rotate.mock.calls[0] as [number, number];
    expect(dx).toBeGreaterThan(0);
    expect(dy).toBe(0);
    expect(event.defaultPrevented).toBe(true);
  });

  it("+ and - dolly like wheel notches", () => {
    const { canvas, dolly, onCameraZoom } = setupInteractions();
    key(canvas, "+");
    key(canvas, "-");
    expect(dolly).toHaveBeenCalledTimes(2);
    expect(onCameraZoom).toHaveBeenCalledTimes(2);
    const zoomIn = dolly.mock.calls[0][0] as number;
    const zoomOut = dolly.mock.calls[1][0] as number;
    expect(zoomIn).toBeLessThan(1);
    expect(zoomOut * zoomIn).toBeCloseTo(1, 12); // a round trip returns home
  });

  it("Shift+arrows ride the SAME onFourDRotate wire as the Shift-drag while 4D", () => {
    const { canvas, onFourDRotate, rotate } = setupInteractions({
      fourD: true,
    });
    key(canvas, "ArrowUp", { shiftKey: true });
    expect(onFourDRotate).toHaveBeenCalledTimes(1);
    expect(onFourDRotate.mock.calls[0][0]).toMatchObject({ xw: 0, zw: 0 });
    expect(
      (onFourDRotate.mock.calls[0][0] as { yw: number }).yw,
    ).toBeGreaterThan(0);
    expect(rotate).not.toHaveBeenCalled();
  });

  it("an unhandled key is left alone — not consumed, nothing called", () => {
    const { canvas, rotate, dolly, onToggleAutoMotion } = setupInteractions();
    const event = key(canvas, "Tab");
    expect(event.defaultPrevented).toBe(false);
    expect(rotate).not.toHaveBeenCalled();
    expect(dolly).not.toHaveBeenCalled();
    expect(onToggleAutoMotion).not.toHaveBeenCalled();
  });

  it("Space toggles auto-motion and consumes the key so the page never scrolls", () => {
    const { canvas, onToggleAutoMotion } = setupInteractions();
    const event = key(canvas, " ");
    expect(onToggleAutoMotion).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("[ and ] nudge the slice only while the slice is on", () => {
    const off = setupInteractions({ fourD: true, sliceOn: false });
    key(off.canvas, "[");
    expect(off.onFourDSliceNudge).not.toHaveBeenCalled();

    const on = setupInteractions({ fourD: true, sliceOn: true });
    key(on.canvas, "]");
    expect(on.onFourDSliceNudge).toHaveBeenCalledTimes(1);
    expect(on.onFourDSliceNudge.mock.calls[0][0] as number).toBeGreaterThan(0);
  });

  it("flat frozen Flame blocks camera keys and its unavailable motion preference", () => {
    const { canvas, rotate, dolly, onToggleAutoMotion } = setupInteractions({
      frozen: true,
    });
    key(canvas, "ArrowLeft");
    key(canvas, "+");
    key(canvas, " ");
    expect(rotate).not.toHaveBeenCalled();
    expect(dolly).not.toHaveBeenCalled();
    expect(onToggleAutoMotion).not.toHaveBeenCalled();
  });

  it("chorded arrows pass through untouched — Alt+Left must stay history-back", () => {
    const { canvas, rotate } = setupInteractions();
    const event = key(canvas, "ArrowLeft", { altKey: true });
    expect(event.defaultPrevented).toBe(false);
    expect(rotate).not.toHaveBeenCalled();
  });
});
