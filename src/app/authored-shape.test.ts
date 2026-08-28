import {
  AUTHORED_SHAPE_KINDS,
  MAX_AUTHORED_SHAPE_SOURCE_BYTES,
  addAuthoredShapePart,
  analyzeAuthoredShapeCapabilities,
  authoredShapeComposerDraft,
  authoredShapeComposerFromDraft,
  authoredShapeComposerStatus,
  authoredShapeComposerValidation,
  authoredShapeDraft,
  authoredShapeFromDraft,
  authoredShapeValidation,
  defaultAuthoredShape,
  defaultAuthoredShapePart,
  removeAuthoredShapePart,
  reorderAuthoredShapePart,
  type AuthoredShapeComposerDraft,
  type AuthoredShapeDraft,
} from "./authored-shape";
import {
  MAX_SHAPE_PARTS,
  shapeSdfSource,
  type ShapeSpec,
} from "../fractal/shapes";
import { bundledEmitterForShape, bundledTrapForShape } from "./bundled-shapes";

function draftFor(kind: (typeof AUTHORED_SHAPE_KINDS)[number]) {
  const draft = authoredShapeDraft(defaultAuthoredShape(kind));
  if (!draft) throw new Error(`missing valid ${kind} default`);
  return draft;
}

describe("authored shape defaults", () => {
  it("offers every analytic non-mesh primitive as a valid one-part union", () => {
    expect(AUTHORED_SHAPE_KINDS).toEqual([
      "sphere",
      "box",
      "torus",
      "capsule",
      "gear",
    ]);

    for (const kind of AUTHORED_SHAPE_KINDS) {
      const spec = defaultAuthoredShape(kind);
      expect(spec.parts).toHaveLength(1);
      expect(spec.parts[0].combine).toBe("union");
      expect(spec.parts[0].primitive.kind).toBe(kind);
      expect(spec.parts[0].pose).toBeUndefined();
      expect(authoredShapeDraft(spec)).toMatchObject({
        offset: [0, 0, 0],
        rotate: [0, 0, 0],
        scale: 1,
      });
    }
  });

  it("defaults to a unit sphere", () => {
    expect(defaultAuthoredShape()).toEqual({
      parts: [
        {
          primitive: { kind: "sphere", radius: 1 },
          combine: "union",
        },
      ],
    });
  });

  it("keeps every custom default distinct from the bundled catalog", () => {
    for (const kind of AUTHORED_SHAPE_KINDS) {
      const shape = defaultAuthoredShape(kind);
      expect(bundledEmitterForShape(shape)).toBeUndefined();
      expect(bundledTrapForShape(shape)).toBeUndefined();
    }
  });
});

describe("authoredShapeDraft", () => {
  it("expands and clones a valid sparse part pose", () => {
    const spec: ShapeSpec = {
      parts: [
        {
          primitive: { kind: "box", half: [1, 2, 3] },
          combine: "union",
          pose: { offset: [4, 5, 6], scale: 2 },
        },
      ],
    };
    const draft = authoredShapeDraft(spec);
    expect(draft).toEqual({
      primitive: { kind: "box", half: [1, 2, 3] },
      offset: [4, 5, 6],
      rotate: [0, 0, 0],
      scale: 2,
    });

    if (!draft || draft.primitive.kind !== "box") throw new Error("bad draft");
    draft.primitive.half[0] = 99;
    draft.offset[0] = 99;
    expect(spec.parts[0]).toEqual({
      primitive: { kind: "box", half: [1, 2, 3] },
      combine: "union",
      pose: { offset: [4, 5, 6], scale: 2 },
    });
  });

  it("keeps catalog meshes, compositions, intersections, and invalid parts opaque", () => {
    expect(
      authoredShapeDraft({
        parts: [
          {
            primitive: { kind: "mesh", meshId: "star-prism-v1" },
            combine: "union",
          },
        ],
      }),
    ).toBeNull();
    expect(
      authoredShapeDraft({
        parts: [
          { primitive: { kind: "sphere", radius: 1 }, combine: "union" },
          { primitive: { kind: "sphere", radius: 1 }, combine: "union" },
        ],
      }),
    ).toBeNull();
    expect(
      authoredShapeDraft({
        parts: [
          { primitive: { kind: "sphere", radius: 1 }, combine: "intersect" },
        ],
      }),
    ).toBeNull();
    expect(
      authoredShapeDraft({
        parts: [{ primitive: { kind: "sphere", radius: 0 }, combine: "union" }],
      }),
    ).toBeNull();
  });
});

describe("authoredShapeValidation", () => {
  it("accepts the inclusive torus and gear coupling boundaries", () => {
    const torus = draftFor("torus");
    if (torus.primitive.kind !== "torus") throw new Error("bad torus draft");
    torus.primitive.minor = torus.primitive.major;
    expect(authoredShapeValidation(torus)).toBeNull();

    const gear = draftFor("gear");
    if (gear.primitive.kind !== "gear") throw new Error("bad gear draft");
    gear.primitive.teeth = 64;
    gear.primitive.hole = 0;
    gear.primitive.tooth[1] =
      gear.primitive.radius * Math.sin(Math.PI / gear.primitive.teeth);
    expect(authoredShapeValidation(gear)).toBeNull();
  });

  it("accepts coincident capsule endpoints as a sphere", () => {
    const draft = draftFor("capsule");
    if (draft.primitive.kind !== "capsule")
      throw new Error("bad capsule draft");
    draft.primitive.b = [...draft.primitive.a];
    expect(authoredShapeValidation(draft)).toBeNull();
  });

  it.each([
    [
      "non-finite offset",
      (draft: AuthoredShapeDraft) => (draft.offset[0] = NaN),
    ],
    [
      "non-finite rotation",
      (draft: AuthoredShapeDraft) => (draft.rotate[1] = Infinity),
    ],
    ["zero scale", (draft: AuthoredShapeDraft) => (draft.scale = 0)],
    ["negative scale", (draft: AuthoredShapeDraft) => (draft.scale = -1)],
  ])("rejects %s", (_label, mutate) => {
    const draft = draftFor("sphere");
    mutate(draft);
    expect(authoredShapeValidation(draft)).not.toBeNull();
  });

  it("rejects positive values that can underflow to zero sampler measure", () => {
    const draft = draftFor("sphere");
    if (draft.primitive.kind !== "sphere") throw new Error("bad sphere draft");
    draft.primitive.radius = 1e-200;
    expect(authoredShapeValidation(draft)).toMatch(/at least/);
    draft.primitive.radius = 1;
    draft.scale = 1e-200;
    expect(authoredShapeValidation(draft)).toMatch(/at least/);
  });

  it("rejects invalid primitive domains", () => {
    const invalid: AuthoredShapeDraft[] = [];

    const sphere = draftFor("sphere");
    if (sphere.primitive.kind !== "sphere") throw new Error("bad sphere draft");
    sphere.primitive.radius = 0;
    invalid.push(sphere);

    const box = draftFor("box");
    if (box.primitive.kind !== "box") throw new Error("bad box draft");
    box.primitive.half[1] = -1;
    invalid.push(box);

    const torus = draftFor("torus");
    if (torus.primitive.kind !== "torus") throw new Error("bad torus draft");
    torus.primitive.minor = torus.primitive.major + 0.01;
    invalid.push(torus);

    const capsule = draftFor("capsule");
    if (capsule.primitive.kind !== "capsule")
      throw new Error("bad capsule draft");
    capsule.primitive.a[2] = NaN;
    invalid.push(capsule);

    const gear = draftFor("gear");
    if (gear.primitive.kind !== "gear") throw new Error("bad gear draft");
    gear.primitive.tooth[1] =
      gear.primitive.radius * Math.sin(Math.PI / gear.primitive.teeth) + 0.01;
    invalid.push(gear);

    for (const draft of invalid) {
      expect(authoredShapeValidation(draft)).not.toBeNull();
      expect(() => authoredShapeFromDraft(draft)).toThrow(RangeError);
    }
  });

  it.each([
    [2, "too few teeth"],
    [65, "too many teeth"],
    [8.5, "fractional teeth"],
  ])("rejects gear teeth %s (%s)", (teeth) => {
    const draft = draftFor("gear");
    if (draft.primitive.kind !== "gear") throw new Error("bad gear draft");
    draft.primitive.teeth = teeth;
    expect(authoredShapeValidation(draft)).toMatch(/3 to 64/);
  });

  it("rejects a gear hole that leaves less than the minimum body annulus", () => {
    const draft = draftFor("gear");
    if (draft.primitive.kind !== "gear") throw new Error("bad gear draft");
    draft.primitive.hole = draft.primitive.radius;
    expect(authoredShapeValidation(draft)).toMatch(/leave at least/);
  });
});

describe("authoredShapeFromDraft", () => {
  it("compacts identity pose fields and clones primitive storage", () => {
    const draft = draftFor("capsule");
    const spec = authoredShapeFromDraft(draft);
    expect(spec.parts[0].pose).toBeUndefined();

    if (draft.primitive.kind !== "capsule")
      throw new Error("bad capsule draft");
    draft.primitive.a[0] = 99;
    expect(spec.parts[0].primitive).not.toEqual(draft.primitive);
  });

  it("emits only non-identity pose fields", () => {
    const draft = draftFor("sphere");
    draft.offset = [1, 2, 3];
    draft.scale = 1.5;
    expect(authoredShapeFromDraft(draft).parts[0].pose).toEqual({
      offset: [1, 2, 3],
      scale: 1.5,
    });
  });
});

function composition(partCount: number, intersect = false): ShapeSpec {
  return {
    parts: Array.from({ length: partCount }, (_, index) => {
      const kind = AUTHORED_SHAPE_KINDS[index % AUTHORED_SHAPE_KINDS.length];
      const part = defaultAuthoredShape(kind).parts[0];
      return {
        primitive: part.primitive,
        combine: intersect && index % 2 === 1 ? "intersect" : "union",
        ...(index % 3 === 0
          ? {}
          : index % 3 === 1
            ? { pose: { offset: [index, -index, index / 2] as const } }
            : {
                pose: {
                  rotate: [index / 10, index / 20, -index / 30] as const,
                  scale: 1 + index / 10,
                },
              }),
      };
    }),
  };
}

describe("flat authored shape composer", () => {
  it(`round-trips 1..${MAX_SHAPE_PARTS} analytic union parts and sparse poses`, () => {
    for (let count = 1; count <= MAX_SHAPE_PARTS; count += 1) {
      const spec = composition(count);
      const draft = authoredShapeComposerDraft(spec, "emitter");
      expect(draft).not.toBeNull();
      expect(authoredShapeComposerFromDraft(draft!, "emitter")).toEqual(spec);
    }
  });

  it("round-trips trap intersections but keeps them opaque to emitters", () => {
    const spec = composition(MAX_SHAPE_PARTS, true);
    const trap = authoredShapeComposerDraft(spec, "trap");
    expect(trap).not.toBeNull();
    expect(authoredShapeComposerFromDraft(trap!, "trap")).toEqual(spec);

    expect(authoredShapeComposerDraft(spec, "emitter")).toBeNull();
    expect(() => authoredShapeComposerFromDraft(trap!, "emitter")).toThrow(
      /Emitter parts must all use union/,
    );
    expect(authoredShapeComposerStatus(spec, "emitter")).toMatchObject({
      status: "opaque",
      reason: "intersection",
      draft: null,
      capabilities: {
        sampleable: false,
        modes: {
          emitter: { eligible: false },
          trap: { eligible: true },
        },
      },
    });
  });

  it("enforces the fixed part range and first-part union", () => {
    expect(authoredShapeComposerValidation({ parts: [] }, "trap")).toMatch(
      /1 to 8/,
    );
    expect(
      authoredShapeComposerValidation(
        {
          parts: Array.from(
            { length: MAX_SHAPE_PARTS + 1 },
            defaultAuthoredShapePart,
          ),
        },
        "trap",
      ),
    ).toMatch(/1 to 8/);

    const invalid = { parts: [defaultAuthoredShapePart()] };
    invalid.parts[0].combine = "intersect";
    expect(authoredShapeComposerValidation(invalid, "trap")).toMatch(
      /first shape part must use union/i,
    );
    expect(
      authoredShapeComposerDraft(
        {
          parts: [
            {
              primitive: { kind: "sphere", radius: 1 },
              combine: "intersect",
            },
          ],
        },
        "trap",
      ),
    ).toBeNull();
  });

  it("refuses an emitter draft whose analytic measure overflows", () => {
    const part = defaultAuthoredShapePart("sphere");
    if (part.primitive.kind !== "sphere") throw new Error("bad sphere");
    part.primitive.radius = Number.MAX_VALUE;
    expect(
      authoredShapeComposerValidation({ parts: [part] }, "emitter"),
    ).toMatch(/non-finite measure/);
    expect(
      authoredShapeComposerValidation({ parts: [part] }, "trap"),
    ).toBeNull();
  });

  it("clones every nested primitive and pose on both sides", () => {
    const spec: ShapeSpec = {
      parts: [
        {
          primitive: { kind: "box", half: [1, 2, 3] },
          combine: "union",
          pose: { offset: [4, 5, 6] },
        },
        {
          primitive: {
            kind: "gear",
            teeth: 8,
            radius: 1,
            tooth: [0.1, 0.1],
            hole: 0.2,
            halfHeight: 0.3,
          },
          combine: "intersect",
        },
      ],
    };
    const draft = authoredShapeComposerDraft(spec, "trap");
    if (!draft) throw new Error("missing composition draft");
    if (draft.parts[0].primitive.kind !== "box") throw new Error("bad box");
    draft.parts[0].primitive.half[0] = 99;
    draft.parts[0].offset[0] = 99;
    expect(spec.parts[0].primitive).toEqual({ kind: "box", half: [1, 2, 3] });
    expect(spec.parts[0].pose?.offset).toEqual([4, 5, 6]);

    const emitted = authoredShapeComposerFromDraft(draft, "trap");
    if (draft.parts[1].primitive.kind !== "gear") throw new Error("bad gear");
    draft.parts[1].primitive.tooth[0] = 99;
    expect(emitted.parts[1].primitive).not.toEqual(draft.parts[1].primitive);
  });
});

describe("authored shape composer operations", () => {
  function operationDraft(): AuthoredShapeComposerDraft {
    return {
      parts: [
        defaultAuthoredShapePart("box"),
        {
          ...defaultAuthoredShapePart("gear"),
          combine: "intersect",
        },
      ],
    };
  }

  it("adds, removes, and reorders immutably", () => {
    const original = operationDraft();
    const added = addAuthoredShapePart(original, "capsule");
    expect(added.parts.map((part) => part.primitive.kind)).toEqual([
      "box",
      "gear",
      "capsule",
    ]);
    expect(added.parts[2].combine).toBe("union");

    const removed = removeAuthoredShapePart(original, 0);
    expect(removed.parts).toHaveLength(1);
    expect(removed.parts[0].primitive.kind).toBe("gear");
    expect(removed.parts[0].combine).toBe("union");

    const reordered = reorderAuthoredShapePart(original, 1, 0);
    expect(reordered.parts.map((part) => part.primitive.kind)).toEqual([
      "gear",
      "box",
    ]);
    expect(reordered.parts[0].combine).toBe("union");

    added.parts[0].offset[0] = 99;
    removed.parts[0].rotate[0] = 99;
    reordered.parts[1].scale = 99;
    expect(original).toEqual(operationDraft());
  });

  it("rejects edits outside the fixed part range", () => {
    expect(() =>
      removeAuthoredShapePart({ parts: [defaultAuthoredShapePart()] }, 0),
    ).toThrow(/at least one/);
    const full = authoredShapeComposerDraft(
      composition(MAX_SHAPE_PARTS),
      "emitter",
    );
    if (!full) throw new Error("missing full draft");
    expect(() => addAuthoredShapePart(full)).toThrow(/cannot exceed/);
    expect(() => reorderAuthoredShapePart(full, -1, 0)).toThrow(/out of range/);
  });
});

describe("authored shape capabilities", () => {
  it("measures both generated dialects in UTF-8 and admits a worst-case draft", () => {
    const draft: AuthoredShapeComposerDraft = {
      parts: Array.from({ length: MAX_SHAPE_PARTS }, (_, index) => ({
        ...defaultAuthoredShapePart("gear"),
        primitive: {
          kind: "gear",
          teeth: 13,
          radius: 0.91234567890123,
          tooth: [0.11234567890123, 0.01234567890123],
          hole: 0.21234567890123,
          halfHeight: 0.312345678901,
        },
        offset: [
          index + 0.12345678901235,
          index + 0.23456789012346,
          index + 0.34567890123457,
        ],
        rotate: [
          index + 0.45678901234568,
          index + 0.56789012345679,
          index + 0.67890123456789,
        ],
        scale: index + 1.12345678901235,
      })),
    };
    const spec = authoredShapeComposerFromDraft(draft, "emitter");
    const capabilities = analyzeAuthoredShapeCapabilities(spec);
    const encoder = new TextEncoder();
    expect(capabilities.glslBytes).toBe(
      encoder.encode(shapeSdfSource(spec, "glsl", "condensation4Sdf23"))
        .byteLength,
    );
    expect(capabilities.wgslBytes).toBe(
      encoder.encode(shapeSdfSource(spec, "wgsl", "condensationShape23"))
        .byteLength,
    );
    expect(capabilities.generatedSourceBytes).toBe(
      Math.max(capabilities.glslBytes, capabilities.wgslBytes),
    );
    expect({
      glslBytes: capabilities.glslBytes,
      wgslBytes: capabilities.wgslBytes,
    }).toEqual({ glslBytes: 8188, wgslBytes: 7909 });
    expect(capabilities.generatedSourceBytes).toBeGreaterThan(
      MAX_AUTHORED_SHAPE_SOURCE_BYTES * 0.99,
    );
    expect(capabilities.generatedSourceBytes).toBeLessThanOrEqual(
      MAX_AUTHORED_SHAPE_SOURCE_BYTES,
    );
    expect(capabilities).toMatchObject({
      status: "editable",
      reason: null,
      sourceBudgetOk: true,
      sampleable: true,
      hasIntersection: false,
      modes: {
        emitter: { eligible: true, reason: null },
        trap: { eligible: true, reason: null },
      },
    });

    const overBudget: AuthoredShapeComposerDraft = {
      parts: draft.parts.map((part) => ({
        ...part,
        offset: [Number.MAX_VALUE, -Number.MAX_VALUE, Number.MAX_VALUE],
      })),
    };
    expect(authoredShapeComposerValidation(overBudget, "emitter")).toMatch(
      /per-dialect limit/,
    );
    expect(() => authoredShapeComposerFromDraft(overBudget, "emitter")).toThrow(
      /per-dialect limit/,
    );
  });

  it("separates opaque editability from actual sampler and SDF capability", () => {
    const mesh: ShapeSpec = {
      parts: [
        {
          primitive: { kind: "mesh", meshId: "star-prism-v1" },
          combine: "union",
        },
      ],
    };
    expect(authoredShapeComposerDraft(mesh, "trap")).toBeNull();
    expect(authoredShapeComposerStatus(mesh, "trap")).toMatchObject({
      status: "opaque",
      reason: "mesh",
      draft: null,
      capabilities: {
        status: "opaque",
        sourceBudgetOk: true,
        sampleable: true,
        modes: {
          emitter: { eligible: true },
          trap: { eligible: true },
        },
      },
    });

    const zeroMeasure = {
      parts: [{ primitive: { kind: "sphere", radius: 0 }, combine: "union" }],
    } as ShapeSpec;
    expect(authoredShapeComposerStatus(zeroMeasure, "trap")).toMatchObject({
      status: "opaque",
      reason: "invalid",
      draft: null,
      capabilities: {
        status: "opaque",
        sampleable: false,
        modes: {
          emitter: { eligible: false },
          trap: { eligible: true },
        },
      },
    });

    const malformed = {
      parts: [
        { primitive: { kind: "sphere", radius: 1 }, combine: "intersect" },
      ],
    } as ShapeSpec;
    expect(authoredShapeComposerStatus(malformed, "trap")).toMatchObject({
      status: "opaque",
      reason: "invalid",
      draft: null,
      capabilities: {
        sampleable: false,
        modes: {
          emitter: { eligible: false },
          trap: { eligible: false },
        },
      },
    });
  });

  it("invalidates cached capabilities when a public ShapeSpec is mutated", () => {
    const mutable: ShapeSpec = {
      parts: [
        {
          primitive: { kind: "sphere", radius: 0.5 },
          combine: "union",
        },
      ],
    };
    expect(analyzeAuthoredShapeCapabilities(mutable).sampleable).toBe(true);
    mutable.parts[0].combine = "intersect";
    expect(analyzeAuthoredShapeCapabilities(mutable)).toMatchObject({
      status: "opaque",
      reason: "invalid",
      sampleable: false,
      sourceBudgetOk: false,
    });
  });
});
