import {
  addTransform,
  DEFAULT_POINT_SIZE,
  initialState,
  MIN_TRANSFORMS,
  removeTransform,
  selectTransform,
  setPointSize,
  setRenderStyle,
  setTransforms,
  updateTransform,
} from "./state";
import { mengerSponge } from "../fractal/presets";
import { mulberry32 } from "../fractal/rng";

describe("initialState", () => {
  it("starts in camera mode with the default system", () => {
    const state = initialState(true);
    expect(state.selectedTransform).toBeNull();
    expect(state.transforms).toHaveLength(4);
    expect(state.colorMode).toBe("transform");
    expect(state.renderStyle).toBe("depthFade");
    expect(state.pointSize).toBe(DEFAULT_POINT_SIZE);
    expect(state.panelOpen).toBe(true);
  });
});

describe("setPointSize", () => {
  it("sets the point-size multiplier immutably", () => {
    const state = initialState(true);
    const next = setPointSize(state, 2.5);
    expect(next.pointSize).toBe(2.5);
    expect(state.pointSize).toBe(DEFAULT_POINT_SIZE);
  });
});

describe("setRenderStyle", () => {
  it("switches the render style immutably", () => {
    const state = initialState(true);
    const next = setRenderStyle(state, "glow");
    expect(next.renderStyle).toBe("glow");
    expect(state.renderStyle).toBe("depthFade");
  });
});

describe("addTransform / removeTransform", () => {
  it("adds a transform immutably", () => {
    const state = initialState(true);
    const next = addTransform(state, mulberry32(1));
    expect(next.transforms).toHaveLength(5);
    expect(state.transforms).toHaveLength(4);
  });

  it("removes the last transform", () => {
    const state = addTransform(initialState(true), mulberry32(1));
    expect(removeTransform(state).transforms).toHaveLength(4);
  });

  it("never drops below the minimum number of transforms", () => {
    let state = initialState(true);
    state = setTransforms(state, [state.transforms[0]]);
    expect(state.transforms).toHaveLength(MIN_TRANSFORMS);
    expect(removeTransform(state).transforms).toHaveLength(MIN_TRANSFORMS);
  });

  it("clears the selection when the selected transform is removed", () => {
    const state = selectTransform(initialState(true), 3);
    expect(removeTransform(state).selectedTransform).toBeNull();
  });

  it("keeps a lower selection index when removing the last transform", () => {
    const state = selectTransform(initialState(true), 1);
    expect(removeTransform(state).selectedTransform).toBe(1);
  });
});

describe("setTransforms", () => {
  it("swaps in a preset and returns to camera mode", () => {
    const state = selectTransform(initialState(true), 2);
    const next = setTransforms(state, mengerSponge());
    expect(next.transforms).toHaveLength(20);
    expect(next.selectedTransform).toBeNull();
  });
});

describe("updateTransform", () => {
  it("edits one transform's geometry while preserving its id", () => {
    const state = initialState(true);
    const originalId = state.transforms[1].id;
    const next = updateTransform(state, 1, {
      position: [9, 9, 9],
      rotation: [0, 0, 0],
      scale: [0.1, 0.1, 0.1],
    });
    expect(next.transforms[1].position).toEqual([9, 9, 9]);
    expect(next.transforms[1].id).toBe(originalId);
    // Other transforms untouched.
    expect(next.transforms[0]).toBe(state.transforms[0]);
  });
});
