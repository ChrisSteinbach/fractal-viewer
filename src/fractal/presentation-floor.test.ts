import {
  PRESENTATION_FLOOR_ALBEDO,
  PRESENTATION_FLOOR_DROP,
  PRESENTATION_FLOOR_FADE_END,
  PRESENTATION_FLOOR_FADE_START,
  presentationFloorSpec,
} from "./presentation-floor";
import {
  packFloorPentagridUniforms,
  pentagridDerived,
  resolveFloorPentagrid,
} from "./pentagrid-floor";

describe("presentationFloorSpec", () => {
  it("pins the shared drop, radial fade, albedo, and authored look", () => {
    expect(PRESENTATION_FLOOR_DROP).toBe(1.02);
    expect(PRESENTATION_FLOOR_FADE_START).toBe(4);
    expect(PRESENTATION_FLOOR_FADE_END).toBe(10);
    expect(PRESENTATION_FLOOR_ALBEDO).toEqual([0.62, 0.62, 0.62]);

    expect(
      presentationFloorSpec(
        { center: [3, 5, -7], radius: 2 },
        { pattern: "checker", tileScale: 0.8, emission: 1.5 },
      ),
    ).toEqual({
      y: 2.96,
      fadeStart: 8,
      fadeEnd: 20,
      ballCenter: [3, 5, -7],
      ballRadius: 2,
      albedo: [0.62, 0.62, 0.62],
      pattern: 1,
      tileScale: 0.8,
      emission: 1.5,
      // The pentagrid payload is present for EVERY pattern (defaults filled,
      // the wire packed once) — read only by the pattern-2 branch.
      pentagrid: resolveFloorPentagrid(undefined),
      pentagridWire: packFloorPentagridUniforms(
        pentagridDerived(resolveFloorPentagrid(undefined), 2, 0.8),
        resolveFloorPentagrid(undefined),
      ),
    });
  });

  it("maps solid to the uniform/wire code zero and refuses a missing ball", () => {
    expect(
      presentationFloorSpec(
        { center: [0, 0, 0], radius: 1 },
        { pattern: "solid", tileScale: 0.64, emission: 0 },
      )?.pattern,
    ).toBe(0);
    expect(
      presentationFloorSpec(null, {
        pattern: "checker",
        tileScale: 2,
        emission: 3,
      }),
    ).toBeNull();
  });

  it("maps pentagrid to the pattern-2 wire code and resolves the look's sparse block", () => {
    const spec = presentationFloorSpec(
      { center: [0, 0, 0], radius: 1 },
      {
        pattern: "pentagrid",
        tileScale: 0.5,
        emission: 0,
        pentagrid: { colorRule: "pair", grout: 2 },
      },
    )!;
    expect(spec.pattern).toBe(2);
    // Absent fields resolve to the defaults; authored ones survive.
    expect(spec.pentagrid.colorRule).toBe("pair");
    expect(spec.pentagrid.grout).toBe(2);
    expect(spec.pentagrid.shifts).toEqual(
      resolveFloorPentagrid(undefined).shifts,
    );
    // The wire is the resolved block packed at this ball's scale.
    expect(spec.pentagridWire).toEqual(
      packFloorPentagridUniforms(
        pentagridDerived(spec.pentagrid, 1, 0.5),
        spec.pentagrid,
      ),
    );
    // An unauthored pentagrid look resolves to the default block.
    expect(
      presentationFloorSpec(
        { center: [0, 0, 0], radius: 1 },
        {
          pattern: "pentagrid",
          tileScale: 0.5,
          emission: 0,
        },
      )!.pentagrid,
    ).toEqual(resolveFloorPentagrid(undefined));
  });

  it("returns fresh vectors and never aliases or mutates its inputs", () => {
    const center: [number, number, number] = [1, 2, 3];
    const ball = { center, radius: 4 };
    const look = { pattern: "solid" as const, tileScale: 0.5, emission: 0.2 };
    const first = presentationFloorSpec(ball, look)!;
    const second = presentationFloorSpec(ball, look)!;

    first.ballCenter[0] = 99;
    first.albedo[0] = 0;
    expect(center).toEqual([1, 2, 3]);
    expect(second.ballCenter).toEqual([1, 2, 3]);
    expect(second.albedo).toEqual([0.62, 0.62, 0.62]);
    expect(look).toEqual({ pattern: "solid", tileScale: 0.5, emission: 0.2 });
  });

  // The scene-palette tie rides the look's optional albedo: present exactly
  // while the backdrop on screen is palette-linked, absent (= neutral)
  // byte-identically otherwise. The 32-float pentagrid wire packs derived
  // geometry and palette coefficients, never the albedo — the tie moves no
  // wire word.
  it("keeps the neutral albedo when the look carries no tie", () => {
    const spec = presentationFloorSpec(
      { center: [0, 0, 0], radius: 1 },
      { pattern: "checker", tileScale: 0.8, emission: 0 },
    )!;
    expect(spec.albedo).toEqual([0.62, 0.62, 0.62]);
  });

  it("lands the tie's albedo in the spec and copies it, leaving the pentagrid wire untouched", () => {
    const tint: [number, number, number] = [0.71, 0.62, 0.53];
    const tied = presentationFloorSpec(
      { center: [0, 0, 0], radius: 1 },
      {
        pattern: "pentagrid",
        tileScale: 0.5,
        emission: 0,
        albedo: tint,
      },
    )!;
    const plain = presentationFloorSpec(
      { center: [0, 0, 0], radius: 1 },
      { pattern: "pentagrid", tileScale: 0.5, emission: 0 },
    )!;
    expect(tied.albedo).toEqual(tint);
    tied.albedo[0] = 0;
    expect(tint).toEqual([0.71, 0.62, 0.53]);
    expect(tied.pentagridWire).toEqual(plain.pentagridWire);
  });
});
