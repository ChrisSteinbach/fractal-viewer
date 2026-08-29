import { MAX_TRANSFORMS } from "../fractal/chaos-game";
import { sierpinskiTetrahedron } from "../fractal/presets";
import { MAX_SHAPE_PARTS } from "../fractal/shapes";
import {
  CROSSOVER_ALGORITHM_VERSION,
  prepareEvolutionCrossover,
} from "./evolution-crossover";
import { createEvolutionCrossoverCandidate } from "./evolution-crossover-candidate";
import { toSnapshot, type SceneSnapshot } from "./persist";
import { initialState } from "./state";

type Corruption = (snapshot: SceneSnapshot) => void;

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("test fixture expected an object");
  }
  return value as Record<string, unknown>;
}

function populatedSnapshot(): SceneSnapshot {
  const snapshot = toSnapshot(initialState(false));
  snapshot.transforms = sierpinskiTetrahedron();
  snapshot.symmetry = { order: 2, plane: "xz", twist: 1 };
  snapshot.transforms[0].variations = [
    { type: "linear", weight: 1, minRadius: -3.25 },
  ];
  snapshot.transforms[0].w = {
    position: -0,
    scale: -0.5,
    rotation: { xw: 0.25 },
    shear: { zw: -0.75 },
  };
  snapshot.transforms[0].finish = {
    specular: -4.25,
    shininess: 1.25e6,
    metalness: -8,
    reflect: 12,
    transmit: -13,
    reflectionTint: 14,
  };
  snapshot.transforms[0].surfacePattern = {
    kind: "wood",
    axis: "z",
    scale: -500.125,
    strength: 900.5,
  };
  snapshot.transforms[0].emitter = {
    parts: [
      {
        primitive: { kind: "sphere", radius: -2.5 },
        combine: "union",
        pose: {
          offset: [-0, 2.25, -3.5],
          rotate: [0.125, -0.25, 0.5],
          scale: -7.75,
        },
      },
    ],
  };
  snapshot.finalTransform = {
    id: 99,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  };
  snapshot.schedule = {
    depth: 2,
    transforms: [
      {
        id: 0,
        position: [0.25, -0.5, 0.75],
        rotation: [0, 0.25, 0],
        scale: [0.5, 0.5, 0.5],
        shear: [0.1, -0.2, 0.3],
        weight: 2,
      },
    ],
  };
  snapshot.condensationDepthBand = { minDepth: 1, maxDepth: 4 };
  snapshot.shapeTrap = {
    shape: {
      parts: [
        {
          primitive: {
            kind: "gear",
            teeth: -3.5,
            radius: -2,
            tooth: [-0.25, 0.5],
            hole: -0.75,
            halfHeight: -1.25,
          },
          combine: "union",
          pose: { offset: [1, 2, 3], rotate: [4, 5, 6], scale: 0 },
        },
      ],
    },
    position: [-1, 2, -3],
    rotation: [0.25, 0.5, 0.75],
    scale: -2,
    mode: "threshold",
    threshold: -4,
    fade: 12,
    geometry: true,
    geometryLevelMin: 1,
    geometryLevelMax: 5,
  };
  snapshot.customPalette = {
    stops: [
      [0, 0.25, 1],
      [1, 0.5, 0],
    ],
  };
  snapshot.positionAxisColors = {
    x: [1, 0, 0],
    y: [0, 1, 0],
    z: [0, 0, 1],
  };
  snapshot.camera = {
    target: [0.125, -0.25, 0.5],
    radius: 8,
    theta: -20.25,
    phi: 1.25,
  };
  snapshot.fourD = {
    pair: { p: [1, 0, 0, 0], q: [0, 1, 0, 0] },
    sliceOn: true,
    sliceCenter: -0,
    sliceThickness: 0.25,
    sliceRelColor: false,
  };
  snapshot.balloonEcho = true;
  snapshot.balloonRadius = 0.25;
  snapshot.balloonPaletteId = "custom";
  snapshot.balloonCustomPalette = {
    stops: [
      [0.1, 0.2, 0.3],
      [0.7, 0.8, 0.9],
    ],
  };
  snapshot.balloonTint = "#123abc";
  snapshot.balloonTintStrength = 0.5;
  snapshot.fogDensity = 0.25;
  snapshot.fogTint = "#abcdef";
  snapshot.fogTintStrength = 0.75;
  snapshot.groundPlane = true;
  snapshot.background = {
    mode: "custom",
    custom: { top: [0.1, 0.2, 0.3], bottom: [0.7, 0.8, 0.9] },
    shape: "radial",
    flamePaletteId: "custom",
  };
  return snapshot;
}

function variation(snapshot: SceneSnapshot): Record<string, unknown> {
  const variations = snapshot.transforms[0].variations;
  if (!variations) throw new Error("test fixture lacks variations");
  return record(variations[0]);
}

function transformW(snapshot: SceneSnapshot): Record<string, unknown> {
  const w = snapshot.transforms[0].w;
  if (!w) throw new Error("test fixture lacks w");
  return record(w);
}

function trap(snapshot: SceneSnapshot) {
  if (!snapshot.shapeTrap) throw new Error("test fixture lacks a shape trap");
  return snapshot.shapeTrap;
}

function corrupt(change: Corruption): SceneSnapshot {
  const snapshot = populatedSnapshot();
  change(snapshot);
  return snapshot;
}

function expectPreflightRefusal(change: Corruption, detail?: RegExp): void {
  const malformedPrimary = corrupt(change);
  const primaryResult = prepareEvolutionCrossover(
    { snapshot: malformedPrimary },
    { snapshot: populatedSnapshot() },
  );
  expect(primaryResult.accepted).toBe(false);
  if (primaryResult.accepted) throw new Error("malformed primary was accepted");
  expect(primaryResult.refusal.code).toBe("invalid-primary");
  if (detail) expect(primaryResult.refusal.detail).toMatch(detail);

  const malformedSecondary = corrupt(change);
  const secondaryResult = prepareEvolutionCrossover(
    { snapshot: populatedSnapshot() },
    { snapshot: malformedSecondary },
  );
  expect(secondaryResult.accepted).toBe(false);
  if (secondaryResult.accepted)
    throw new Error("malformed secondary was accepted");
  expect(secondaryResult.refusal.code).toBe("invalid-secondary");

  const candidate = createEvolutionCrossoverCandidate(
    { snapshot: malformedPrimary },
    { snapshot: populatedSnapshot() },
    {
      algorithmVersion: CROSSOVER_ALGORITHM_VERSION,
      nodeSeed: 1,
      childOrdinal: 0,
      surfaceRequired: false,
    },
  );
  expect(candidate.accepted).toBe(false);
  if (candidate.accepted) throw new Error("malformed input produced a child");
  expect(candidate.rejection.reason).toBe("preflight-refusal");
}

describe("crossover-v1 exact SceneSnapshot validation", () => {
  it("accepts exact codec-valid sparse and resolver-owned values", () => {
    const primary = populatedSnapshot();
    const secondary = populatedSnapshot();
    primary.transforms[0].chaos = [-2.125];
    secondary.transforms[0].chaos = [-3.25, 1, 1, 1, 99.5];
    primary.transforms[0].variations?.push({
      type: "linear",
      weight: -0,
      fixedRadius: -1e9 + 0.125,
      boxLimit: 1e9 + 0.25,
    });
    primary.transforms[0].position[0] = -0;
    primary.colorGamma = 1.2345678901234567;

    const result = prepareEvolutionCrossover(
      { snapshot: primary },
      { snapshot: secondary },
    );
    if (!result.accepted) throw new Error(result.refusal.detail);
    expect(result.accepted).toBe(true);
  });

  it.each<[string, Corruption]>([
    [
      "Date in an all-optional block",
      (s) => (record(s).condensationDepthBand = new Date(0)),
    ],
    [
      "Map in an all-optional block",
      (s) => (record(s.transforms[0]).finish = new Map()),
    ],
    [
      "custom record prototype",
      (s) => {
        const band = s.condensationDepthBand!;
        record(s).condensationDepthBand = Object.assign(
          Object.create({ inherited: true }) as Record<string, unknown>,
          band,
        );
      },
    ],
    [
      "accessor field",
      (s) => {
        Object.defineProperty(s.condensationDepthBand!, "maxDepth", {
          enumerable: true,
          get: () => 5,
        });
      },
    ],
    [
      "non-enumerable record field",
      (s) => {
        Object.defineProperty(s, "condensationDepthBand", {
          configurable: true,
          enumerable: false,
          value: s.condensationDepthBand,
          writable: true,
        });
      },
    ],
    [
      "non-enumerable array entry",
      (s) => {
        Object.defineProperty(s.transforms[0].position, "0", {
          configurable: true,
          enumerable: false,
          value: 0,
          writable: true,
        });
      },
    ],
    [
      "custom array prototype",
      (s) => {
        Object.setPrototypeOf(s.transforms[0].position, Object.create(null));
      },
    ],
  ])("rejects exotic authority structure: %s", (_name, change) => {
    expectPreflightRefusal(change);
  });

  it.each<[string, Corruption]>([
    ["SceneSnapshot", (s) => Object.assign(s, { futureScene: 1 })],
    ["Transform", (s) => Object.assign(s.transforms[0], { futureMap: 1 })],
    ["Variation", (s) => Object.assign(variation(s), { futureVariation: 1 })],
    ["W", (s) => Object.assign(transformW(s), { futureW: 1 })],
    [
      "W rotation",
      (s) => Object.assign(record(transformW(s).rotation), { futurePlane: 1 }),
    ],
    [
      "finish",
      (s) => Object.assign(record(s.transforms[0].finish), { futureFinish: 1 }),
    ],
    [
      "surface pattern",
      (s) =>
        Object.assign(record(s.transforms[0].surfacePattern), {
          futurePattern: 1,
        }),
    ],
    ["schedule", (s) => Object.assign(record(s.schedule), { futureWord: 1 })],
    [
      "schedule transform",
      (s) => Object.assign(record(s.schedule?.transforms[0]), { futureMap: 1 }),
    ],
    [
      "condensation band",
      (s) => Object.assign(record(s.condensationDepthBand), { futureBand: 1 }),
    ],
    ["shape trap", (s) => Object.assign(trap(s), { futureTrap: 1 })],
    ["ShapeSpec", (s) => Object.assign(trap(s).shape, { futureShape: 1 })],
    [
      "ShapePart",
      (s) => Object.assign(trap(s).shape.parts[0], { futurePart: 1 }),
    ],
    [
      "ShapePrimitive",
      (s) =>
        Object.assign(trap(s).shape.parts[0].primitive, {
          futurePrimitive: 1,
        }),
    ],
    [
      "ShapePose",
      (s) =>
        Object.assign(record(trap(s).shape.parts[0].pose), { futurePose: 1 }),
    ],
    ["symmetry", (s) => Object.assign(s.symmetry, { futureSymmetry: 1 })],
    ["camera", (s) => Object.assign(record(s.camera), { futureCamera: 1 })],
    ["fourD", (s) => Object.assign(record(s.fourD), { futureView: 1 })],
    [
      "fourD pair",
      (s) => Object.assign(record(s.fourD?.pair), { futureRotor: 1 }),
    ],
    ["flame", (s) => Object.assign(s.flame, { futureFlame: 1 })],
    ["solid", (s) => Object.assign(s.solid, { futureSolid: 1 })],
    ["surface", (s) => Object.assign(s.surface, { futureSurface: 1 })],
    [
      "custom palette",
      (s) => Object.assign(record(s.customPalette), { futurePalette: 1 }),
    ],
    [
      "axis colors",
      (s) => Object.assign(record(s.positionAxisColors), { futureAxis: 1 }),
    ],
    ["background", (s) => Object.assign(s.background, { futureBackdrop: 1 })],
    [
      "background gradient",
      (s) => Object.assign(record(s.background.custom), { futureGradient: 1 }),
    ],
    [
      "balloon custom palette",
      (s) =>
        Object.assign(record(s.balloonCustomPalette), { futurePalette: 1 }),
    ],
  ])("rejects an unknown member at the %s boundary", (_name, change) => {
    expectPreflightRefusal(change, /not a crossover-v1 field/);
  });

  it.each<[string, Corruption]>([
    ["missing variation weight", (s) => delete variation(s).weight],
    ["string variation weight", (s) => (variation(s).weight = "1")],
    ["over-cap variation weight", (s) => (variation(s).weight = 101)],
    ["unknown variation", (s) => (variation(s).type = "future-fold")],
    ["non-finite fold value", (s) => (variation(s).minRadius = Infinity)],
    ["bad transform id", (s) => (record(s.transforms[0]).id = 1.5)],
    ["bad transform weight", (s) => (record(s.transforms[0]).weight = 0)],
    ["bad color index", (s) => (record(s.transforms[0]).colorIndex = 2)],
    [
      "missing Vec3 entry",
      (s) => {
        Reflect.deleteProperty(s.transforms[0].position, "1");
      },
    ],
    ["non-finite chaos", (s) => (s.transforms[0].chaos = [NaN])],
    [
      "over-cap chaos",
      (s) =>
        (s.transforms[0].chaos = Array.from(
          { length: MAX_TRANSFORMS + 1 },
          () => 1,
        )),
    ],
    ["malformed W", (s) => (record(s.transforms[0]).w = [])],
    ["zero W scale", (s) => (transformW(s).scale = 0)],
    ["string W plane", (s) => (record(transformW(s).rotation).xw = "0.2")],
    [
      "non-finite finish",
      (s) => (record(s.transforms[0].finish).reflect = NaN),
    ],
    [
      "missing pattern discriminator",
      (s) => delete record(s.transforms[0].surfacePattern).kind,
    ],
    [
      "bad pattern axis",
      (s) => (record(s.transforms[0].surfacePattern).axis = "w"),
    ],
    [
      "bad shape combine",
      (s) => (record(trap(s).shape.parts[0]).combine = "xor"),
    ],
    [
      "bad primitive discriminator",
      (s) => (record(trap(s).shape.parts[0].primitive).kind = "future-shape"),
    ],
    [
      "non-finite shape pose",
      (s) => (record(trap(s).shape.parts[0].pose).scale = Infinity),
    ],
    ["bad trap mode", (s) => (record(trap(s)).mode = "closest")],
    ["bad trap boolean", (s) => (record(trap(s)).geometry = 1)],
    ["reversed trap levels", (s) => (trap(s).geometryLevelMin = 6)],
    ["bad schedule depth", (s) => (record(s.schedule).depth = 6)],
    [
      "schedule variation",
      (s) => (record(s.schedule?.transforms[0]).variations = []),
    ],
    [
      "reversed condensation band",
      (s) => (s.condensationDepthBand!.minDepth = 5),
    ],
    ["symmetry over cap", (s) => (s.symmetry.order = 13)],
    ["symmetry bad plane", (s) => (record(s.symmetry).plane = "xx")],
    ["symmetry bad twist", (s) => (s.symmetry.twist = 2)],
    ["symmetry morph blend", (s) => (s.symmetry.blend = 0.5)],
    ["bad scene color mode", (s) => (record(s).colorMode = "future-color")],
    ["bad 4D color mode", (s) => (record(s).fourDColor = "future-4d-color")],
    ["bad render style", (s) => (record(s).renderStyle = "future-render")],
    ["bad guide boolean", (s) => (record(s).showGuides = "false")],
    ["bad depth-fade boolean", (s) => (record(s).fourDDepthFade = 0)],
    ["bad ramp palette", (s) => (record(s).rampPaletteId = "future-palette")],
    ["bad background mode", (s) => (record(s.background).mode = "future-bg")],
    ["bad background shape", (s) => (record(s.background).shape = "square")],
    ["missing custom gradient", (s) => delete record(s.background).custom],
    [
      "bad flame palette",
      (s) => (record(s.flame).paletteId = "future-palette"),
    ],
    ["missing flame field", (s) => delete record(s.flame).gamma],
    ["string flame number", (s) => (record(s.flame).iterations = "100")],
    ["bad solid boolean", (s) => (record(s.solid).floorEnabled = "true")],
    ["bad solid pattern", (s) => (record(s.solid).floorPattern = "dots")],
    ["off-step solid resolution", (s) => (record(s.solid).resolution = 129)],
    ["bad surface boolean", (s) => (record(s.surface).depthOfField = 1)],
    [
      "bad surface source",
      (s) => (record(s.surface).colorSource = "future-source"),
    ],
    ["bad surface samples", (s) => (record(s.surface).antialiasSamples = 3)],
    ["malformed camera target", (s) => (record(s.camera).target = [1, 2])],
    [
      "out-of-range camera target",
      (s) => (record(s.camera).target = [1001, 0, 0]),
    ],
    ["out-of-range camera radius", (s) => (record(s.camera).radius = 101)],
    ["string camera angle", (s) => (record(s.camera).theta = "1")],
    ["malformed fourD pair", (s) => (record(s.fourD?.pair).p = [1, 0, 0])],
    [
      "unnormalized fourD pair",
      (s) => (record(s.fourD?.pair).q = [2, 0, 0, 0]),
    ],
    ["bad fourD boolean", (s) => (record(s.fourD).sliceOn = "true")],
    ["bad fourD center", (s) => (record(s.fourD).sliceCenter = 2)],
    ["bad fourD thickness", (s) => (record(s.fourD).sliceThickness = 0.75)],
    [
      "bad custom RGB",
      (s) => ((s.customPalette!.stops[0] as unknown as number[])[0] = 2),
    ],
    ["bad axis RGB length", (s) => (record(s.positionAxisColors).x = [1, 0])],
    [
      "bad background RGB",
      (s) => ((s.background.custom!.top as unknown as number[])[0] = -1),
    ],
    [
      "bad balloon palette",
      (s) => (record(s).balloonPaletteId = "future-palette"),
    ],
    ["bad balloon boolean", (s) => (record(s).balloonEcho = "true")],
    ["bad balloon tint", (s) => (record(s).balloonTint = "red")],
    ["bad fog scalar", (s) => (record(s).fogDensity = "0.2")],
    ["bad fog tint", (s) => (record(s).fogTint = "#abcd")],
    ["bad ground boolean", (s) => (record(s).groundPlane = 1)],
  ])("rejects malformed exact state: %s", (_name, change) => {
    expectPreflightRefusal(change);
  });

  it.each<[string, Corruption]>([
    ["empty transforms", (s) => (s.transforms = [])],
    [
      "too many transforms",
      (s) => {
        s.transforms = Array.from({ length: MAX_TRANSFORMS + 1 }, (_, id) => ({
          id,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
        }));
      },
    ],
    ["empty schedule", (s) => (s.schedule!.transforms = [])],
    [
      "too many schedule maps",
      (s) => {
        s.schedule!.transforms = Array.from(
          { length: MAX_TRANSFORMS + 1 },
          (_, id) => ({
            id,
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: [0.5, 0.5, 0.5],
          }),
        );
      },
    ],
    [
      "too many shape parts",
      (s) => {
        trap(s).shape.parts = Array.from(
          { length: MAX_SHAPE_PARTS + 1 },
          () => ({
            primitive: { kind: "sphere" as const, radius: 1 },
            combine: "union" as const,
          }),
        );
      },
    ],
    [
      "too many custom stops",
      (s) => {
        record(s.customPalette).stops = Array.from({ length: 9 }, () => [
          0, 0, 0,
        ]);
      },
    ],
    [
      "too many variations",
      (s) => {
        s.transforms[0].variations = Array.from({ length: 100 }, () => ({
          type: "linear" as const,
          weight: 1,
        }));
      },
    ],
  ])("rejects document cap violations: %s", (_name, change) => {
    expectPreflightRefusal(change);
  });
});
