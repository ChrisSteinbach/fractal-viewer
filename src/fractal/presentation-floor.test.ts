import {
  PRESENTATION_FLOOR_ALBEDO,
  PRESENTATION_FLOOR_DROP,
  PRESENTATION_FLOOR_FADE_END,
  PRESENTATION_FLOOR_FADE_START,
  presentationFloorSpec,
} from "./presentation-floor";

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
});
