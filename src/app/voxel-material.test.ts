import { marchStepsForGrid } from "./voxel-material";

describe("marchStepsForGrid", () => {
  it("holds the 220-step floor below the 256³ tuning point", () => {
    expect(marchStepsForGrid(192)).toBe(220);
  });

  it("returns exactly the tuned 220 steps at 256³", () => {
    expect(marchStepsForGrid(256)).toBe(220);
  });

  it("scales past the tuning point so the stride stays ~1.16 voxels", () => {
    expect(marchStepsForGrid(320)).toBe(275);
  });

  it("doubles the steps when the grid doubles to 512³", () => {
    expect(marchStepsForGrid(512)).toBe(440);
  });
});
