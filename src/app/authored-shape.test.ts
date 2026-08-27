import {
  AUTHORED_SHAPE_KINDS,
  authoredShapeDraft,
  authoredShapeFromDraft,
  authoredShapeValidation,
  defaultAuthoredShape,
  type AuthoredShapeDraft,
} from "./authored-shape";
import type { ShapeSpec } from "../fractal/shapes";
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
