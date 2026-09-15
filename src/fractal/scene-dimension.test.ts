import { scenePartsAreNonFlat } from "./scene-dimension";
import type { SymmetryParams, Transform } from "./types";

const flat: Transform[] = [
  { id: 0, position: [0, 0, 0], rotation: [0, 0, 0], scale: [0.5, 0.5, 0.5] },
];
const nonFlat: Transform[] = [{ ...flat[0], w: { position: 0.4 } }];
const noSymmetry: SymmetryParams = { order: 1, plane: "xy" };

describe("scenePartsAreNonFlat", () => {
  it("is the transform system's flatness when no block is present", () => {
    expect(scenePartsAreNonFlat(flat, null, noSymmetry, undefined)).toBe(false);
    expect(scenePartsAreNonFlat(nonFlat, null, noSymmetry, null)).toBe(true);
  });

  it("follows a present block's arrangement over the transforms in both directions", () => {
    expect(
      scenePartsAreNonFlat(flat, null, noSymmetry, { arrangement: "cell24" }),
    ).toBe(true);
    expect(
      scenePartsAreNonFlat(nonFlat, null, noSymmetry, { arrangement: "ico12" }),
    ).toBe(false);
  });

  it("still follows the arrangement when the block is refused for another reason", () => {
    expect(
      scenePartsAreNonFlat(flat, null, noSymmetry, {
        arrangement: "cell600",
        depth: -1,
      }),
    ).toBe(true);
  });

  it("falls back to the transform system when the block names no registry arrangement", () => {
    expect(
      scenePartsAreNonFlat(nonFlat, null, noSymmetry, { arrangement: "x" }),
    ).toBe(true);
    expect(scenePartsAreNonFlat(flat, null, noSymmetry, {})).toBe(false);
  });
});
