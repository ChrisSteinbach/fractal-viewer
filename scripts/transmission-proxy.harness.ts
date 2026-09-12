/** Finite-solid transmission comparison. Evidence: docs/surface-transmission.md. */
import { boxUnionIntervals, finiteOpticalSolid } from "./transmission-proxy";
import type { Vec3 } from "./de-preview";

describe("Finite optical solid oracles", () => {
  it("merges overlapping solids but preserves arbitrarily thin real gaps", () => {
    const boxes = [
      { center: [0, 0, 0], half: 1 },
      { center: [0, 0, -1], half: 1 },
      { center: [0, 0, -3.00001], half: 1 },
    ];
    expect(boxUnionIntervals(boxes, [0, 0, 4], [0, 0, -1])).toEqual([
      { enter: 3, exit: 6 },
      { enter: 6.00001, exit: 8.00001 },
    ]);
    expect(boxUnionIntervals(boxes, [2, 0, 4], [0, 0, -1])).toEqual([]);
    expect(boxUnionIntervals(boxes, [0, 0, 0], [0, 0, 1])).toEqual([
      { enter: 0, exit: 1 },
    ]);
  });

  it("finds exact entries and exits through a filled, rotated 4D slice", () => {
    const solid = finiteOpticalSolid(4, 0, 0.48, 0.1);
    const intervals = solid.intervals([0, 0, 4], [0, 0, -1]);
    expect(intervals).toEqual([{ enter: 3.35, exit: 4.65 }]);
    expect(solid.contains([0, 0, 0])).toBe(true);
    expect(solid.contains([0, 0, 0.66])).toBe(false);
  });

  it.each([3, 4] as const)(
    "matches independent membership samples for finite %iD construction",
    (dimension) => {
      const solid = finiteOpticalSolid(dimension);
      expect(solid.boxes.length).toBe(dimension === 3 ? 400 : 256);
      let crossings = 0;
      // Independent direct box membership checks every sampled ray point.
      // Midpoints avoid relying on either oracle's boundary rounding.
      for (let x = -0.7; x < 0.71; x += 0.14) {
        for (let y = -0.7; y < 0.71; y += 0.14) {
          const origin: Vec3 = [x, y, 2];
          const intervals = solid.intervals(origin, [0, 0, -1]);
          crossings += intervals.length;
          for (let t = 0.012345; t < 4; t += 0.019) {
            const expected = intervals.some((i) => i.enter < t && t < i.exit);
            expect(solid.contains([x, y, 2 - t])).toBe(expected);
          }
        }
      }
      expect(crossings).toBeGreaterThan(0);
    },
  );
});
