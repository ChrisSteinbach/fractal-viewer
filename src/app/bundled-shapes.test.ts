import {
  BUNDLED_EMITTER_SHAPES,
  BUNDLED_SHAPES,
  BUNDLED_TRAP_SHAPES,
  bundledEmitterShape,
  bundledEmitterForShape,
  bundledShapeEntry,
  bundledShapeOptionLabel,
  bundledShapeSpec,
  bundledTrapForShape,
} from "./bundled-shapes";
import {
  CRESCENT_MOON_SHAPE,
  FACETED_CRYSTAL_SHAPE,
  GEAR_SHAPE,
  HEART_PRISM_SHAPE,
  ORBIT_RING_SHAPE,
  PEACE_SIGN_SHAPE,
  SNOWFLAKE_PRISM_SHAPE,
  STAR_PRISM_SHAPE,
  TREFOIL_KNOT_SHAPE,
  type ShapeSpec,
} from "../fractal/shapes";

const EXPECTED_SHAPES = [
  ["gear", GEAR_SHAPE],
  ["star", STAR_PRISM_SHAPE],
  ["orbit-ring", ORBIT_RING_SHAPE],
  ["faceted-crystal", FACETED_CRYSTAL_SHAPE],
  ["heart-prism", HEART_PRISM_SHAPE],
  ["trefoil-knot", TREFOIL_KNOT_SHAPE],
  ["crescent-moon", CRESCENT_MOON_SHAPE],
  ["snowflake-prism", SNOWFLAKE_PRISM_SHAPE],
  ["peace", PEACE_SIGN_SHAPE],
] as const;

describe("bundled shape registry", () => {
  it("owns unique stable kinds and the canonical shipped ShapeSpecs", () => {
    expect(BUNDLED_SHAPES.map((entry) => entry.kind)).toEqual([
      "gear",
      "star",
      "orbit-ring",
      "faceted-crystal",
      "heart-prism",
      "trefoil-knot",
      "crescent-moon",
      "snowflake-prism",
      "peace",
    ]);
    expect(new Set(BUNDLED_SHAPES.map((entry) => entry.kind)).size).toBe(
      BUNDLED_SHAPES.length,
    );
    expect(
      new Set(BUNDLED_SHAPES.map((entry) => JSON.stringify(entry.shape))).size,
    ).toBe(BUNDLED_SHAPES.length);
    for (const [kind, shape] of EXPECTED_SHAPES) {
      expect(bundledShapeSpec(kind)).toBe(shape);
      expect(bundledEmitterShape(kind)).toBe(shape);
    }
    expect(bundledShapeEntry("not-shipped")).toBeUndefined();
  });

  it("derives each eligibility list exactly once in registry order", () => {
    expect(BUNDLED_EMITTER_SHAPES).toEqual(
      BUNDLED_SHAPES.filter((entry) => entry.emitter),
    );
    expect(BUNDLED_TRAP_SHAPES).toEqual(
      BUNDLED_SHAPES.filter((entry) => entry.trap),
    );
    expect(BUNDLED_EMITTER_SHAPES.map((entry) => entry.kind)).toEqual([
      "gear",
      "star",
      "orbit-ring",
      "faceted-crystal",
      "heart-prism",
      "trefoil-knot",
      "crescent-moon",
      "snowflake-prism",
      "peace",
    ]);
    expect(BUNDLED_TRAP_SHAPES.map((entry) => entry.kind)).toEqual([
      "gear",
      "star",
      "orbit-ring",
      "faceted-crystal",
      "heart-prism",
      "trefoil-knot",
      "crescent-moon",
      "snowflake-prism",
      "peace",
    ]);
  });

  it("owns the option labels, including icons", () => {
    expect(BUNDLED_SHAPES.map(bundledShapeOptionLabel)).toEqual([
      "⚙ Cog",
      "★ Star",
      "◎ Orbit Ring",
      "◆ Faceted Crystal",
      "♥ Heart Prism",
      "⌘ Trefoil Knot",
      "☾ Crescent Moon",
      "❄ Snowflake Prism",
      "☮ Peace sign",
    ]);
  });

  it("matches exact and wire-canonical copies without promoting authored specs", () => {
    const gearCopy = structuredClone(GEAR_SHAPE);
    expect(bundledEmitterForShape(gearCopy)?.kind).toBe("gear");
    expect(bundledTrapForShape(gearCopy)?.kind).toBe("gear");
    for (const [kind, shape] of EXPECTED_SHAPES) {
      expect(bundledEmitterForShape(structuredClone(shape))?.kind).toBe(kind);
      expect(bundledTrapForShape(structuredClone(shape))?.kind).toBe(kind);
    }
    expect(bundledTrapForShape(structuredClone(PEACE_SIGN_SHAPE))?.kind).toBe(
      "peace",
    );

    const importedPeace = structuredClone(PEACE_SIGN_SHAPE);
    for (const part of importedPeace.parts) {
      const primitive = part.primitive;
      if (primitive.kind !== "capsule") continue;
      primitive.a = primitive.a.map((n) => Math.round(n * 10_000) / 10_000) as [
        number,
        number,
        number,
      ];
      primitive.b = primitive.b.map((n) => Math.round(n * 10_000) / 10_000) as [
        number,
        number,
        number,
      ];
    }
    expect(bundledEmitterForShape(importedPeace)?.kind).toBe("peace");

    const authored: ShapeSpec = {
      parts: [
        {
          primitive: { kind: "sphere", radius: 0.7312 },
          combine: "union",
        },
      ],
    };
    expect(bundledEmitterForShape(authored)).toBeUndefined();
    expect(bundledTrapForShape(authored)).toBeUndefined();
  });
});
