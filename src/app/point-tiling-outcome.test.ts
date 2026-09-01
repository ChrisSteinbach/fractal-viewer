import { pointCountLabel } from "./point-tiling-outcome";

describe("pointCountLabel", () => {
  it("keeps the ordinary and refused cloud label unchanged", () => {
    expect(pointCountLabel(100_000)).toBe("100,000 pts");
    expect(
      pointCountLabel(100_000, {
        availability: "refused",
        note: "incompatible",
      }),
    ).toBe("100,000 pts");
  });

  it.each([
    ["complete", 100_000],
    ["underfilled", 12_345],
    ["empty", 0],
  ] as const)("discloses the %s tiled output budget", (fill, count) => {
    expect(
      pointCountLabel(count, {
        availability: "active",
        kind: "lattice",
        fill,
        requested: 100_000,
        attempts: 800_000,
        accepted: count,
        candidateTests: count,
      }),
    ).toBe(`${count.toLocaleString()} / 100,000 pts · ${fill}`);
  });
});
