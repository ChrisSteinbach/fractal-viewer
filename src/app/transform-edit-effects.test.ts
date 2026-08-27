import { systemPartsAreNonFlat } from "../fractal/affine4";
import type { SymmetryParams, Transform } from "../fractal/types";
import type { SurfaceColorSource } from "./state";
import {
  classifyTransformEdit,
  planTransformEdit,
  type TransformEditDelta,
  type TransformEditPlanContext,
  type TransformEditSnapshot,
} from "./transform-edit-effects";

const FLAT_SYMMETRY: SymmetryParams = { order: 1, plane: "xy" };

function transform(id: number, patch: Partial<Transform> = {}): Transform {
  return {
    id,
    position: [id * 0.1, 0, 0],
    rotation: [0, 0, 0],
    scale: [0.5, 0.5, 0.5],
    ...patch,
  };
}

function snapshot(
  transforms: readonly Transform[] = [transform(0), transform(1)],
  patch: Partial<TransformEditSnapshot> = {},
): TransformEditSnapshot {
  return {
    transforms,
    symmetry: FLAT_SYMMETRY,
    ...patch,
  };
}

function replaceTransform(
  scene: TransformEditSnapshot,
  index: number,
  patch: Partial<Transform>,
): TransformEditSnapshot {
  return {
    ...scene,
    transforms: scene.transforms.map((entry, current) =>
      current === index ? { ...entry, ...patch } : entry,
    ),
  };
}

function emptyDelta(
  patch: Partial<TransformEditDelta> = {},
): TransformEditDelta {
  return {
    geometry: false,
    colorIndex: false,
    colorSpeed: false,
    finish: false,
    pattern: false,
    dimensionChanged: false,
    colorIndexTransforms: [],
    colorSpeedTransforms: [],
    finishTransforms: [],
    patternTransforms: [],
    ...patch,
  };
}

function context(
  patch: Omit<Partial<TransformEditPlanContext>, "surface"> & {
    surface?: Partial<TransformEditPlanContext["surface"]>;
  } = {},
): TransformEditPlanContext {
  const document = patch.document ?? snapshot();
  const surface = {
    eligibility: { status: "eligible" as const, kind: "ifs" as const },
    colorSource: "transform" as const,
    shapeTrapActive: false,
    ...patch.surface,
  };
  return {
    document,
    displayedNonFlat:
      patch.displayedNonFlat ??
      systemPartsAreNonFlat(
        document.transforms,
        document.finalTransform ?? null,
        document.symmetry,
      ),
    activeRenderNonFlat:
      patch.activeRenderNonFlat ??
      systemPartsAreNonFlat(
        document.transforms,
        document.finalTransform ?? null,
        document.symmetry,
      ),
    pointSupportCurrent: true,
    renderMode: "points",
    autoUpdate: true,
    balloonEcho: false,
    colorMode: "transform",
    fourDColor: "transform",
    flamePaletteId: "legacy",
    solidPaletteId: "legacy",
    ...patch,
    surface,
  };
}

function nonFlatDocument(): TransformEditSnapshot {
  return replaceTransform(snapshot(), 0, { w: { position: 0.25 } });
}

describe("classifyTransformEdit", () => {
  it("treats a structurally equal deep clone as a complete no-op", () => {
    const previous = snapshot(
      [
        transform(0, {
          shear: [0.1, 0.2, 0.3],
          variations: [
            {
              type: "mandelbox",
              weight: 0.8,
              minRadius: 0.4,
              fixedRadius: 1.2,
              boxLimit: 0.9,
            },
          ],
          w: {
            position: 0.2,
            scale: 0.4,
            rotation: { xw: 0.3 },
            shear: { zw: 0.1 },
          },
          chaos: [1, 0.2],
          colorIndex: 0.3,
          colorSpeed: 0.7,
          finish: { specular: 0.25 },
          surfacePattern: {
            kind: "wood",
            axis: "x",
            scale: 2,
            strength: 0.5,
          },
        }),
      ],
      { finalTransform: transform(99, { shear: [0.1, 0, 0] }) },
    );
    const next = structuredClone(previous);

    expect(classifyTransformEdit(previous, next)).toEqual(emptyDelta());
  });

  it("normalizes sparse editor defaults so a first appearance edit is not geometry", () => {
    const previous = snapshot([transform(0)]);
    const next = replaceTransform(previous, 0, {
      weight: 1,
      shear: [0, 0, 0],
      variations: [],
      colorIndex: 0.2,
      finish: { specular: 0.4 },
      surfacePattern: { kind: "wood", axis: "y" },
    });

    expect(classifyTransformEdit(previous, next)).toMatchObject({
      geometry: false,
      colorIndex: true,
      finish: true,
      pattern: true,
      colorIndexTransforms: [0],
      finishTransforms: [0],
      patternTransforms: [0],
    });
  });

  it("reports independent appearance fields and their next-state slots", () => {
    const previous = snapshot();
    const next = replaceTransform(
      replaceTransform(previous, 0, {
        colorIndex: 0.2,
        finish: { metalness: 0.6 },
      }),
      1,
      {
        colorSpeed: 0.9,
        surfacePattern: { kind: "marble", axis: "z" },
      },
    );

    expect(classifyTransformEdit(previous, next)).toEqual(
      emptyDelta({
        colorIndex: true,
        colorSpeed: true,
        finish: true,
        pattern: true,
        colorIndexTransforms: [0],
        colorSpeedTransforms: [1],
        finishTransforms: [0],
        patternTransforms: [1],
      }),
    );
  });

  it.each<[string, (entry: Transform) => Transform]>([
    ["position", (entry) => ({ ...entry, position: [1, 2, 3] })],
    ["rotation", (entry) => ({ ...entry, rotation: [0.1, 0.2, 0.3] })],
    ["scale", (entry) => ({ ...entry, scale: [0.4, 0.3, 0.2] })],
    ["weight", (entry) => ({ ...entry, weight: 2 })],
    ["shear", (entry) => ({ ...entry, shear: [0.2, 0, 0] })],
    [
      "variation",
      (entry) => ({
        ...entry,
        variations: [{ type: "spherical", weight: 0.8 }],
      }),
    ],
    [
      "fold parameters",
      (entry) => ({
        ...entry,
        variations: [
          {
            type: "mandelbox",
            weight: 1,
            minRadius: 0.25,
            fixedRadius: 0.9,
            boxLimit: 1.2,
          },
        ],
      }),
    ],
    ["4D extension", (entry) => ({ ...entry, w: { rotation: { xw: 0.2 } } })],
    ["chaos row", (entry) => ({ ...entry, chaos: [0.2, 1] })],
    [
      "emitter",
      (entry) => ({
        ...entry,
        emitter: {
          parts: [
            {
              primitive: { kind: "sphere", radius: 0.5 },
              combine: "union",
            },
          ],
        },
      }),
    ],
  ])("classifies %s edits as geometry", (_label, mutate) => {
    const previous = snapshot();
    const next = {
      ...previous,
      transforms: [mutate(previous.transforms[0]), previous.transforms[1]],
    };

    expect(classifyTransformEdit(previous, next)).toMatchObject({
      geometry: true,
    });
  });

  it("classifies topology, id order, final lens, and symmetry as geometry", () => {
    const previous = snapshot();
    const cases: TransformEditSnapshot[] = [
      { ...previous, transforms: [...previous.transforms, transform(2)] },
      {
        ...previous,
        transforms: [previous.transforms[1], previous.transforms[0]],
      },
      {
        ...previous,
        transforms: [
          { ...previous.transforms[0], id: 7 },
          previous.transforms[1],
        ],
      },
      { ...previous, finalTransform: transform(90) },
      { ...previous, symmetry: { order: 3, plane: "xy" } },
    ];

    for (const next of cases) {
      expect(classifyTransformEdit(previous, next).geometry).toBe(true);
    }
  });

  it("keeps reorder as geometry without inventing appearance edits", () => {
    const previous = snapshot([
      transform(4, { colorIndex: 0.2, finish: { specular: 0.3 } }),
      transform(8, { colorIndex: 0.8, finish: { specular: 0.9 } }),
    ]);
    const next = {
      ...previous,
      transforms: [previous.transforms[1], previous.transforms[0]],
    };

    expect(classifyTransformEdit(previous, next)).toEqual(
      emptyDelta({ geometry: true }),
    );
  });

  it("derives dimension crossings from maps, lens, and symmetry", () => {
    const previous = snapshot();
    const nextDocuments = [
      replaceTransform(previous, 0, { w: { position: 0.2 } }),
      { ...previous, finalTransform: transform(9, { w: { scale: 0.8 } }) },
      { ...previous, symmetry: { order: 3, plane: "xw" as const } },
      { ...previous, symmetry: { order: 3, plane: "xy" as const, twist: 1 } },
    ];

    for (const next of nextDocuments) {
      expect(classifyTransformEdit(previous, next)).toMatchObject({
        geometry: true,
        dimensionChanged: true,
      });
    }
    expect(
      classifyTransformEdit(previous, {
        ...previous,
        symmetry: { order: 5, plane: "xy" },
      }),
    ).toMatchObject({ geometry: true, dimensionChanged: false });
  });
});

describe("planTransformEdit: Points cache", () => {
  it.each([
    [true, "regenerate"],
    [false, "none"],
  ] as const)(
    "plans geometry with Auto-update %s as %s and always refreshes eligibility",
    (autoUpdate, points) => {
      expect(
        planTransformEdit(
          emptyDelta({ geometry: true }),
          context({ autoUpdate }),
        ),
      ).toEqual({
        points,
        active: "none",
        refreshSurfaceEligibility: true,
        reuseActiveSeed: false,
        preserveSurfaceView: false,
      });
    },
  );

  it.each([
    [snapshot(), "transform", "transform", "recolor-flat"],
    [snapshot(), "height", "transform", "none"],
    [nonFlatDocument(), "transform", "transform", "recolor-4d"],
    [nonFlatDocument(), "transform", "radius", "none"],
  ] as const)(
    "gates Color Index recoloring by the displayed dimension's source",
    (document, colorMode, fourDColor, points) => {
      expect(
        planTransformEdit(
          emptyDelta({ colorIndex: true, colorIndexTransforms: [0] }),
          context({
            document,
            colorMode,
            fourDColor,
          }),
        ).points,
      ).toBe(points);
    },
  );

  it("preserves the inspection camera across transform-driven Surface re-entry", () => {
    expect(
      planTransformEdit(
        emptyDelta({ geometry: true }),
        context({ renderMode: "surface" }),
      ).preserveSurfaceView,
    ).toBe(true);
  });

  it("uses the cached cloud dimension while a document crossing is staged", () => {
    expect(
      planTransformEdit(
        emptyDelta({ colorIndex: true, colorIndexTransforms: [0] }),
        context({
          document: snapshot(),
          displayedNonFlat: true,
          fourDColor: "transform",
        }),
      ).points,
    ).toBe("recolor-4d");
  });

  it.each([
    emptyDelta({ colorSpeed: true, colorSpeedTransforms: [0] }),
    emptyDelta({ finish: true, finishTransforms: [0] }),
    emptyDelta({ pattern: true, patternTransforms: [0] }),
  ])("does no Points work for speed or Surface material state", (delta) => {
    expect(planTransformEdit(delta, context()).points).toBe("none");
  });
});

describe("planTransformEdit: geometry routing", () => {
  it.each([
    ["flame", "restart-flame"],
    ["solid", "restart-solid"],
    ["surface", "reenter-surface"],
  ] as const)(
    "restarts/re-enters flat Balloon-off %s at commit",
    (renderMode, active) => {
      expect(
        planTransformEdit(
          emptyDelta({ geometry: true }),
          context({ renderMode }),
        ).active,
      ).toBe(active);
    },
  );

  it.each(["flame", "solid"] as const)(
    "stages non-flat %s geometry for next entry",
    (renderMode) => {
      expect(
        planTransformEdit(
          emptyDelta({ geometry: true }),
          context({ document: nonFlatDocument(), renderMode }),
        ).active,
      ).toBe("next-entry");
    },
  );

  it.each(["flame", "solid"] as const)(
    "stages Balloon %s geometry for next entry",
    (renderMode) => {
      expect(
        planTransformEdit(
          emptyDelta({ geometry: true }),
          context({ balloonEcho: true, renderMode }),
        ).active,
      ).toBe("next-entry");
    },
  );

  it.each([
    [nonFlatDocument(), false],
    [snapshot(), true],
  ] as const)(
    "re-enters Surface geometry independently of Points support",
    (document, balloonEcho) => {
      expect(
        planTransformEdit(
          emptyDelta({ geometry: true }),
          context({ document, balloonEcho, renderMode: "surface" }),
        ).active,
      ).toBe("reenter-surface");
    },
  );

  it("stages a non-flat -> flat crossing even though the next document is flat", () => {
    expect(
      planTransformEdit(
        emptyDelta({ geometry: true, dimensionChanged: true }),
        context({ renderMode: "solid" }),
      ).active,
    ).toBe("next-entry");
  });

  it("also stages flat authored geometry while the active session is non-flat", () => {
    expect(
      planTransformEdit(
        emptyDelta({ geometry: true }),
        context({
          document: snapshot(),
          activeRenderNonFlat: true,
          renderMode: "flame",
        }),
      ).active,
    ).toBe("next-entry");
  });

  it("re-enters flat Surface geometry even when the next eligibility is refused", () => {
    expect(
      planTransformEdit(
        emptyDelta({ geometry: true }),
        context({
          renderMode: "surface",
          surface: {
            eligibility: { status: "ineligible", kind: null },
          },
        }),
      ).active,
    ).toBe("reenter-surface");
  });
});

describe("planTransformEdit: Flame and Solid color consumers", () => {
  const indexDelta = emptyDelta({
    colorIndex: true,
    colorIndexTransforms: [0],
  });
  const speedDelta = emptyDelta({
    colorSpeed: true,
    colorSpeedTransforms: [0],
  });

  it("uses the active accumulation dimension rather than a newer hidden Points cloud", () => {
    const plan = planTransformEdit(
      indexDelta,
      context({
        document: nonFlatDocument(),
        displayedNonFlat: true,
        activeRenderNonFlat: false,
        pointSupportCurrent: true,
        renderMode: "solid",
        solidPaletteId: "legacy",
        colorMode: "transform",
        fourDColor: "wBlueOrange",
      }),
    );
    expect(plan.active).toBe("restart-solid");
    expect(plan.reuseActiveSeed).toBe(true);
  });

  it.each([
    [snapshot(), "legacy", "wBlueOrange", "restart-flame"],
    [nonFlatDocument(), "legacy", "transform", "restart-flame"],
    [nonFlatDocument(), "legacy", "wBlueOrange", "none"],
    [snapshot(), "spectrum", "wBlueOrange", "restart-flame"],
    [nonFlatDocument(), "custom", "wBlueOrange", "restart-flame"],
  ] as const)(
    "gates Flame Color Index by palette and 4D source",
    (document, flamePaletteId, fourDColor, active) => {
      expect(
        planTransformEdit(
          indexDelta,
          context({
            document,
            renderMode: "flame",
            flamePaletteId,
            fourDColor,
          }),
        ).active,
      ).toBe(active);
    },
  );

  it.each([
    ["legacy", "none"],
    ["spectrum", "restart-flame"],
    ["custom", "restart-flame"],
  ] as const)("gates Flame Color Speed under %s", (flamePaletteId, active) => {
    expect(
      planTransformEdit(
        speedDelta,
        context({ renderMode: "flame", flamePaletteId }),
      ).active,
    ).toBe(active);
  });

  it.each([
    [snapshot(), "legacy", "transform", "wBlueOrange", "restart-solid"],
    [snapshot(), "legacy", "height", "transform", "none"],
    [nonFlatDocument(), "legacy", "height", "transform", "restart-solid"],
    [nonFlatDocument(), "legacy", "transform", "wBlueOrange", "none"],
    [snapshot(), "spectrum", "height", "wBlueOrange", "restart-solid"],
    [nonFlatDocument(), "custom", "height", "wBlueOrange", "restart-solid"],
  ] as const)(
    "gates Solid Color Index by palette and active dimension source",
    (document, solidPaletteId, colorMode, fourDColor, active) => {
      expect(
        planTransformEdit(
          indexDelta,
          context({
            document,
            renderMode: "solid",
            solidPaletteId,
            colorMode,
            fourDColor,
          }),
        ).active,
      ).toBe(active);
    },
  );

  it.each([
    ["legacy", "none"],
    ["spectrum", "restart-solid"],
    ["custom", "restart-solid"],
  ] as const)("gates Solid Color Speed under %s", (solidPaletteId, active) => {
    expect(
      planTransformEdit(
        speedDelta,
        context({ renderMode: "solid", solidPaletteId }),
      ).active,
    ).toBe(active);
  });

  it("keeps pure color support-safe under non-flat Balloon sessions", () => {
    const plan = planTransformEdit(
      indexDelta,
      context({
        document: nonFlatDocument(),
        renderMode: "flame",
        balloonEcho: true,
        flamePaletteId: "spectrum",
      }),
    );
    expect(plan.active).toBe("restart-flame");
    expect(plan.reuseActiveSeed).toBe(true);
    expect(plan.preserveSurfaceView).toBe(false);
  });

  it.each([
    ["flame", nonFlatDocument(), false, "next-entry"],
    ["solid", nonFlatDocument(), false, "next-entry"],
    ["flame", snapshot(), true, "next-entry"],
    ["solid", snapshot(), true, "next-entry"],
    ["flame", snapshot(), false, "restart-flame"],
    ["solid", snapshot(), false, "restart-solid"],
  ] as const)(
    "does not mistake color-only for support-safe after staged %s geometry",
    (renderMode, document, balloonEcho, active) => {
      const palettePatch =
        renderMode === "flame"
          ? { flamePaletteId: "spectrum" as const }
          : { solidPaletteId: "spectrum" as const };
      expect(
        planTransformEdit(
          indexDelta,
          context({
            document,
            renderMode,
            balloonEcho,
            pointSupportCurrent: false,
            ...palettePatch,
          }),
        ).active,
      ).toBe(active);
    },
  );
});

describe("planTransformEdit: Surface appearance consumers", () => {
  const document = snapshot([
    transform(0, { weight: 0 }),
    transform(1),
    transform(2),
  ]);
  const indexAt = (index: number) =>
    emptyDelta({ colorIndex: true, colorIndexTransforms: [index] });
  const finishAt = (index: number) =>
    emptyDelta({ finish: true, finishTransforms: [index] });
  const patternAt = (index: number) =>
    emptyDelta({ pattern: true, patternTransforms: [index] });
  const surfaceContext = (
    kind: "ifs" | "ifs4" | "escape" | "escape4" | "bulb",
    colorSource: SurfaceColorSource = "transform",
  ) =>
    context({
      document,
      renderMode: "surface",
      surface: {
        eligibility: { status: "eligible", kind },
        colorSource,
      },
    });

  it.each(["ifs", "ifs4"] as const)(
    "re-enters %s for active IFS slot colors/materials and ignores Weight-0 slots",
    (kind) => {
      for (const delta of [indexAt(1), finishAt(1), patternAt(2)]) {
        expect(planTransformEdit(delta, surfaceContext(kind)).active).toBe(
          "reenter-surface",
        );
      }
      for (const delta of [indexAt(0), finishAt(0), patternAt(0)]) {
        expect(planTransformEdit(delta, surfaceContext(kind)).active).toBe(
          "none",
        );
      }
    },
  );

  it.each(["escape", "escape4", "bulb"] as const)(
    "uses only the first positive-weight material/color slot on %s",
    (kind) => {
      for (const delta of [indexAt(1), finishAt(1), patternAt(1)]) {
        expect(planTransformEdit(delta, surfaceContext(kind)).active).toBe(
          "reenter-surface",
        );
      }
      for (const delta of [indexAt(0), finishAt(2), patternAt(2)]) {
        expect(planTransformEdit(delta, surfaceContext(kind)).active).toBe(
          "none",
        );
      }
    },
  );

  it("reads Color Index for IFS Palette but not forward Palette", () => {
    expect(
      planTransformEdit(indexAt(1), surfaceContext("ifs", "palette")).active,
    ).toBe("reenter-surface");
    expect(
      planTransformEdit(indexAt(1), surfaceContext("ifs4", "palette")).active,
    ).toBe("reenter-surface");
    expect(
      planTransformEdit(indexAt(1), surfaceContext("escape", "palette")).active,
    ).toBe("none");
  });

  it.each(["height", "radius", "rings", "sheets"] as const)(
    "does not read Color Index under Surface %s",
    (colorSource) => {
      expect(
        planTransformEdit(indexAt(1), surfaceContext("ifs", colorSource))
          .active,
      ).toBe("none");
    },
  );

  it("resolves dormant Shape Trap to By Transform and a live forward trap to its own channel", () => {
    expect(
      planTransformEdit(indexAt(1), surfaceContext("ifs", "shapeTrap")).active,
    ).toBe("reenter-surface");
    expect(
      planTransformEdit(
        indexAt(1),
        context({
          document,
          renderMode: "surface",
          surface: {
            eligibility: { status: "eligible", kind: "escape" },
            colorSource: "shapeTrap",
            shapeTrapActive: false,
          },
        }),
      ).active,
    ).toBe("reenter-surface");
    expect(
      planTransformEdit(
        indexAt(1),
        context({
          document,
          renderMode: "surface",
          surface: {
            eligibility: { status: "eligible", kind: "escape" },
            colorSource: "shapeTrap",
            shapeTrapActive: true,
          },
        }),
      ).active,
    ).toBe("none");
  });

  it("never reads per-transform Color Speed", () => {
    expect(
      planTransformEdit(
        emptyDelta({ colorSpeed: true, colorSpeedTransforms: [1] }),
        surfaceContext("ifs", "palette"),
      ).active,
    ).toBe("none");
  });

  it("stages appearance for a refused route", () => {
    const refused = context({
      document,
      renderMode: "surface",
      surface: {
        eligibility: { status: "ineligible", kind: null },
        colorSource: "transform",
      },
    });
    for (const delta of [indexAt(1), finishAt(1), patternAt(1)]) {
      expect(planTransformEdit(delta, refused).active).toBe("none");
    }
  });

  it("re-enters for support-safe material edits in 4D and Balloon sessions", () => {
    const nonFlat = { ...nonFlatDocument(), transforms: document.transforms };
    const active = context({
      document: {
        ...nonFlat,
        transforms: [
          { ...document.transforms[0], w: { position: 0.2 } },
          ...document.transforms.slice(1),
        ],
      },
      renderMode: "surface",
      balloonEcho: true,
      surface: {
        eligibility: { status: "degraded", kind: "ifs4" },
        colorSource: "transform",
      },
    });
    const plan = planTransformEdit(finishAt(1), active);
    expect(plan.active).toBe("reenter-surface");
    expect(plan.preserveSurfaceView).toBe(true);
    expect(plan.reuseActiveSeed).toBe(false);
  });

  it("re-enters Surface material independently of stale Points support", () => {
    const stale = context({
      document: {
        ...document,
        transforms: [
          { ...document.transforms[0], w: { position: 0.2 } },
          ...document.transforms.slice(1),
        ],
      },
      renderMode: "surface",
      balloonEcho: true,
      pointSupportCurrent: false,
      surface: {
        eligibility: { status: "degraded", kind: "ifs4" },
        colorSource: "transform",
      },
    });
    const plan = planTransformEdit(finishAt(1), stale);
    expect(plan.active).toBe("reenter-surface");
    expect(plan.preserveSurfaceView).toBe(true);
  });
});
