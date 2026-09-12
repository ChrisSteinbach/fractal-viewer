/** Independent finite-geometry adversaries for the sampled appearance model. */
import { mkdirSync, writeFileSync } from "node:fs";
import { boxUnionIntervals } from "./transmission-proxy";
import { renderTransmission } from "./transmission-study";
import type { Fixture } from "./transmission-study";
import type { Vec3 } from "./de-preview";

function finiteGap(gap: number, dimension: 3 | 4): Fixture {
  const boxes = [
    { center: dimension === 3 ? [0, 0, 0.3] : [0, 0, 0.3, 0.02], half: 0.05 },
    {
      center: dimension === 3 ? [0, 0, 0.2 - gap] : [0, 0, 0.2 - gap, 0.02],
      half: 0.05,
    },
  ];
  const c = Math.cos(0.35);
  const s = Math.sin(0.35);
  const query = (p: Vec3) =>
    dimension === 3
      ? p
      : [c * p[0] - s * 0.02, p[1], p[2], s * p[0] + c * 0.02];
  const origin = query([0, 0, 3]);
  const direction = dimension === 3 ? [0, 0, -1] : [0, 0, -1, 0];
  // The independent analytic solid has TWO runs at every positive gap. The
  // appearance model may intentionally merge them; that is the test's point.
  expect(boxUnionIntervals(boxes, origin, direction)).toHaveLength(2);
  return {
    name: `FINITE GAP ${dimension}D ${gap}`,
    scene: {
      de(p) {
        const q = query(p);
        return Math.min(
          ...boxes.map((box) => {
            const outside = q.map((v, i) =>
              Math.max(0, Math.abs(v - box.center[i]) - box.half),
            );
            return Math.hypot(...outside);
          }),
        );
      },
      boundingRadius: 1,
      stepScale: 1,
      eye: [0, 0, 3],
      zoom: 0.36,
    },
    color: () => [0.12, 0.8, 0.96],
  };
}

describe("World transmission gap and interior controls", () => {
  it("excludes an exact ball endpoint and a zero-length tangent domain", () => {
    const fixture = finiteGap(0.008, 3);
    // The only accepted point lies at the excluded far endpoint z = -R.
    fixture.scene.de = (p) => (p[2] <= -1 ? 0 : 1);
    const run = () =>
      renderTransmission(fixture, 0.9, true, 1, 8, 0.5, 1200, {
        strategy: "world",
        warp: false,
      });
    const axial = run();
    expect(axial.eventCounts[0]).toBe(0);
    expect(axial.work.primary).toBe(2000);
    expect(axial.unresolved).toBe(0);

    fixture.scene.eye = [1, 0, 3];
    fixture.scene.target = [1, 0, 0];
    fixture.scene.boundingCenter = [0, 0, 0];
    fixture.scene.de = () => 0;
    const tangent = run();
    expect(tangent.eventCounts[0]).toBe(0);
    expect(tangent.work.primary).toBe(0);
    expect(tangent.unresolved).toBe(0);
  });

  it("discloses the clearance gap cutoff and its sample-phase ambiguity in 3D and 4D", () => {
    const rows: object[] = [];
    for (const dimension of [3, 4] as const) {
      for (const gapSteps of [0.5, 1, 2, 3, 4, 6, 6.25, 6.5, 7, 8, 12]) {
        for (const scanPhase of [0, 0.5]) {
          const fixture = finiteGap(gapSteps * 0.001, dimension);
          const result = renderTransmission(
            fixture,
            0.9,
            true,
            1,
            8,
            0.5,
            1200,
            {
              strategy: "world",
              warp: false,
              worldBand: { scanPhase, chunkSteps: 257 },
            },
          );
          expect(result.unresolved).toBe(0);
          if (gapSteps < 6) expect(result.eventCounts[0]).toBe(1);
          if (gapSteps >= 8) expect(result.eventCounts[0]).toBe(2);
          rows.push({
            dimension,
            gapSteps,
            scanPhase,
            exactSolidRuns: 2,
            events: result.eventCounts[0],
            opticalThroughput: result.finalThroughput[0],
          });
        }
      }
    }
    mkdirSync("scripts/out", { recursive: true });
    writeFileSync(
      "scripts/out/transmission-gap-report.json",
      JSON.stringify(rows, null, 2),
    );
    console.log(JSON.stringify({ gapRows: rows }));
  });

  it("does not turn an interior plateau into repeated optical density or a budget miss", () => {
    for (const dimension of [3, 4] as const) {
      const fixture = finiteGap(0.001, dimension);
      // This declared carrier-clipped low field is an appearance adversary,
      // never a claim of generic DE membership outside the declared sphere.
      fixture.scene.de = () => 0;
      const run = (chunkSteps: number, maxChunks: number) =>
        renderTransmission(fixture, 0.9, true, 1, 8, 0.5, 1200, {
          strategy: "world",
          warp: false,
          worldBand: { chunkSteps, maxChunks },
        });
      const a = run(7, 4096);
      const b = run(503, 4096);
      expect(a.unresolved).toBe(0);
      expect(a.eventCounts[0]).toBe(1);
      expect(a.eventCounts).toEqual(b.eventCounts);
      expect(a.finalThroughput).toEqual(b.finalThroughput);
      expect(a.stats.rgb).toEqual(b.stats.rgb);
      const capped = run(7, 1);
      expect(capped.unresolved).toBe(1);
      expect(capped.termination.sphereCap).toBe(0);
      expect(capped.stats.rgb.some((v, i) => v < a.stats.rgb[i])).toBe(true);
    }
  });
});
