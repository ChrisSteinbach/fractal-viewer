import {
  deriveScratchRoute,
  resolveScratchCore,
  scratchCoreProbes,
  scratchDocScene,
  scratchPresetScene,
} from "./scratch-scene";
import { encodeScene, toSnapshot } from "../persist";
import { initialState, setTransforms } from "../state";
import { mandelboxCube, tesseract } from "../../fractal/presets";
import { identityRotorPair, rotateInPlane } from "../rotor4";

describe("scratch scene: presets", () => {
  it("unknown names refuse as null", () => {
    expect(scratchPresetScene("noSuchPreset")).toBeNull();
  });

  it("a fold preset routes to the fold core with its authored lens", () => {
    const scene = scratchPresetScene("mandelboxKifs");
    expect(scene).not.toBeNull();
    expect(scene!.refusals).toEqual([]);
    const route = deriveScratchRoute(scene!);
    expect(route.kind).toBe("ifs");
    expect(route.core).toBe("fold");
    expect(route.view4.sliceHalfW).toBe(0);
    expect(route.view4.w0).toBe(0);
  });

  it("a fold-free preset routes to the affine core", () => {
    const route = deriveScratchRoute(scratchPresetScene("sierpinski")!);
    expect(route.kind).toBe("ifs");
    expect(route.core).toBe("affine");
  });

  it("a scheduled preset carries the schedule into the DE", () => {
    const scene = scratchPresetScene("spongeOfFerns")!;
    expect(scene.schedule).not.toBeNull();
    const route = deriveScratchRoute(scene);
    expect(route.kind).toBe("ifs");
    expect(
      route.de && "schedule" in route.de ? (route.de.schedule?.depth ?? 0) : 0,
    ).toBeGreaterThan(0);
  });

  it("an escape-chain preset routes to the escape core", () => {
    const route = deriveScratchRoute(scratchPresetScene("mandelboxClassic")!);
    expect(route.kind).toBe("escape");
    expect(route.core).toBe("escape");
  });

  it("a triplex-power preset routes to the bulb core", () => {
    const route = deriveScratchRoute(scratchPresetScene("mandelbulbClassic")!);
    expect(route.kind).toBe("bulb");
    expect(route.core).toBe("bulb");
  });

  it("a 4D escape preset routes to escape4", () => {
    const scene = scratchPresetScene("mandelboxBrick")!;
    const route = deriveScratchRoute(scene);
    expect(route.kind).toBe("escape4");
    expect(route.core).toBe("escape4");
  });

  it("a preset whose authored view carries a rotor lands it in view4", () => {
    // A document path: toSnapshot never attaches the 4D pose (main.ts does,
    // only for a persisted/shared document), so the test attaches one the
    // same way a share link would carry it.
    let state = initialState(false);
    state = setTransforms(state, tesseract());
    const snapshot = {
      ...toSnapshot(state),
      fourD: {
        pair: rotateInPlane(identityRotorPair(), "xw", 0.4),
        sliceOn: true,
        sliceCenter: 0,
        sliceW: 0.25,
        sliceThickness: 0,
        sliceRelColor: false,
      },
    };
    const scene = scratchDocScene(encodeScene(snapshot));
    expect(scene.view4).not.toBeNull();
    expect(scene.view4!.w0).toBe(0.25);
    const route = deriveScratchRoute(scene);
    expect(route.kind).toBe("ifs4");
    expect(route.view4.rotor).not.toEqual([
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
    ]);
  });

  it("a sphere-inversion preset routes frame-only, without a probe leg", () => {
    const scene = scratchPresetScene("inversionPearls")!;
    expect(scene.sphereInversion).not.toBeNull();
    const route = deriveScratchRoute(scene);
    expect(route.kind).toBe("sphereInversion");
    expect(route.core).toBe("sphereInv");
    expect(scratchCoreProbes(route.core)).toBe(false);
  });

  it("a glass preset routes to the finite solid's frame-only core", () => {
    const route = deriveScratchRoute(scratchPresetScene("glassMenger")!);
    expect(route.kind).toBe("finiteSolid");
    expect(route.core).toBe("finite");
    expect(route.finiteLevel).toBeGreaterThan(0);
    expect(scratchCoreProbes(route.core)).toBe(false);
  });
});

describe("scratch scene: documents", () => {
  it("a decoded document round-trips its system and 4D pose", () => {
    let state = initialState(false);
    state = setTransforms(state, mandelboxCube());
    const encoded = encodeScene(toSnapshot(state));
    const scene = scratchDocScene(encoded);
    expect(scene.source).toBe("doc");
    expect(scene.transforms.length).toBe(mandelboxCube().length);
    const route = deriveScratchRoute(scene);
    expect(route.core).toBe("escape");
  });

  it("a share link's #hash form is accepted", () => {
    // The app builds links as `...#${encodeScene(...)}` and encodeScene
    // already carries the `v1=` token, so the hash is `#v1=<payload>`.
    let state = initialState(false);
    state = setTransforms(state, mandelboxCube());
    const link = `https://fractal-4d.com/#${encodeScene(toSnapshot(state))}`;
    const scene = scratchDocScene(link.slice(link.indexOf("#")));
    expect(scene.transforms.length).toBe(mandelboxCube().length);
  });

  it("a payload that does not decode throws", () => {
    expect(() => scratchDocScene("!!!not-a-document!!!")).toThrow();
  });
});

describe("scratch core resolution", () => {
  it("absent means the derived core", () => {
    expect(resolveScratchCore(null, "fold")).toBe("fold");
    expect(resolveScratchCore("", "affine4")).toBe("affine4");
  });

  it("a matching --core passes through", () => {
    expect(resolveScratchCore("fold4", "fold4")).toBe("fold4");
  });

  it("an unknown id refuses with the vocabulary", () => {
    expect(() => resolveScratchCore("coreX", "fold")).toThrow(/unknown --core/);
  });

  it("a mismatched id refuses naming both", () => {
    expect(() => resolveScratchCore("affine", "fold")).toThrow(
      /does not match the scene's route \(fold\)/,
    );
  });

  it("the seven descent/forward cores probe; the two extra families do not", () => {
    for (const core of [
      "affine",
      "fold",
      "escape",
      "bulb",
      "affine4",
      "fold4",
      "escape4",
    ] as const) {
      expect(scratchCoreProbes(core)).toBe(true);
    }
    expect(scratchCoreProbes("sphereInv")).toBe(false);
    expect(scratchCoreProbes("finite4")).toBe(false);
  });
});
