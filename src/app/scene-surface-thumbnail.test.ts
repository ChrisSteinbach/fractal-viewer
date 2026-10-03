// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { FractalScene } from "./scene";

function bareScene(): FractalScene {
  return Object.create(FractalScene.prototype) as FractalScene;
}

function stubCaptureFields(scene: FractalScene): void {
  Reflect.set(scene, "surfaceComputeActive", false);
  Reflect.set(scene, "surfaceCaptureFlight", false);
  Reflect.set(scene, "rightInsetPx", 0);
  Reflect.set(scene, "pointsViewLayout", "single");
  Reflect.set(scene, "surfaceLightGuidesVisible", false);
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 4;
  Reflect.set(scene, "renderer", { domElement: canvas });
}

describe("FractalScene captureThumbnail surface arm", () => {
  it("re-presents the settled mean instead of re-tracing when the census is current", () => {
    const scene = bareScene();
    stubCaptureFields(scene);
    Reflect.set(scene, "surfaceSettledRayCensus", {
      rays: 4,
      covered: 4,
      miss: 0,
      exhausted: 0,
      exhaustedIndices: [],
    });
    let presented = 0;
    Reflect.set(scene, "presentSettledSurface", () => {
      presented += 1;
    });
    let traced = 0;
    Reflect.set(scene, "renderSurface", () => {
      traced += 1;
    });

    scene.captureThumbnail("surface");

    // A synchronous full-frame re-trace re-presents a 1-sample frame over
    // the pane's supersampled mean — visibly grainier, unhealed while the
    // centered wrapper is a no-op — so a current settled frame is
    // re-presented instead and the trace never runs.
    expect(presented).toBe(1);
    expect(traced).toBe(0);
    // jsdom's 2D context is unavailable: the thumbnail degrades to the
    // collection's "no image" value rather than throwing.
    expect(scene.captureThumbnail("surface")).toBe("");
  });

  it("falls through to the trace when the settled evidence is stale (census null)", () => {
    const scene = bareScene();
    stubCaptureFields(scene);
    Reflect.set(scene, "surfaceSettledRayCensus", null);
    let presented = 0;
    Reflect.set(scene, "presentSettledSurface", () => {
      presented += 1;
    });
    let traced = 0;
    Reflect.set(scene, "renderSurface", () => {
      traced += 1;
    });

    scene.captureThumbnail("surface");

    // A save taken mid-preview or before pass 0 folded asks for a pose the
    // settled mean does not cover — the pre-supersampling trace is still
    // the honest answer there.
    expect(presented).toBe(0);
    expect(traced).toBe(1);
  });

  it("does not paint over a capture that owns the tracer", () => {
    const scene = bareScene();
    stubCaptureFields(scene);
    Reflect.set(scene, "surfaceCaptureFlight", true);
    Reflect.set(scene, "surfaceSettledRayCensus", {
      rays: 4,
      covered: 4,
      miss: 0,
      exhausted: 0,
      exhaustedIndices: [],
    });
    let presented = 0;
    Reflect.set(scene, "presentSettledSurface", () => {
      presented += 1;
    });
    let traced = 0;
    Reflect.set(scene, "renderSurface", () => {
      traced += 1;
    });

    scene.captureThumbnail("surface");

    // A capture job never presents; a thumbnail blit mid-drain must not
    // either. The early-return the real renderSurface performs leaves the
    // pre-capture canvas — which IS the settled frame — for the readback.
    expect(presented).toBe(0);
    expect(traced).toBe(1);
  });
});
