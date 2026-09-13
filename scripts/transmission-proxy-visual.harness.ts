/**
 * Compare the public display object with an explicitly finite optical solid.
 * Uses de-preview for every camera ray/hit; writes regenerable artifacts only.
 * TRANSMISSION_PROXY_SIZE defaults to 80. No production/render admission claim.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { writeLabeledContactSheet } from "./de-preview";
import type { PanelStats, Vec3 } from "./de-preview";
import { finiteOpticalSolid } from "./transmission-proxy";
import {
  proceduralRear,
  renderFiniteTransmission,
} from "./transmission-proxy-render";
import { delta, fixtures, renderTransmission } from "./transmission-study";

const SIZE = Number(process.env.TRANSMISSION_PROXY_SIZE ?? 80);

describe("Finite optical solid appearance comparison", () => {
  it("transmits a real procedural floor and obeys the opaque limit in both dimensions", () => {
    for (const dimension of [3, 4] as const) {
      const solid = finiteOpticalSolid(dimension, 0, 0.35, 0.2);
      const scene = {
        de: (p: Vec3) => solid.distance(p),
        boundingRadius: solid.radius,
        stepScale: 1,
        eyeOffset: [0.3, 0.4, 2.5] as Vec3,
        zoom: 0.25,
      };
      const color = (): Vec3 => [0.12, 0.8, 0.96];
      const floor = proceduralRear(solid.radius, true);
      const uniform = proceduralRear(solid.radius, false);
      const opaqueFloor = renderFiniteTransmission(
        solid,
        scene,
        color,
        33,
        0,
        0.8,
        floor,
      );
      const opaqueSky = renderFiniteTransmission(
        solid,
        scene,
        color,
        33,
        0,
        0.8,
        uniform,
      );
      const throughFloor = renderFiniteTransmission(
        solid,
        scene,
        color,
        33,
        0.9,
        0.8,
        floor,
      );
      const throughSky = renderFiniteTransmission(
        solid,
        scene,
        color,
        33,
        0.9,
        0.8,
        uniform,
      );
      const center = (16 * 33 + 16) * 3;
      expect([...opaqueFloor.stats.rgb.slice(center, center + 3)]).toEqual([
        ...opaqueSky.stats.rgb.slice(center, center + 3),
      ]);
      expect(
        Math.abs(throughFloor.stats.rgb[center] - throughSky.stats.rgb[center]),
      ).toBeGreaterThan(5);
      expect(throughFloor.unresolved).toBe(0);
      expect(throughSky.unresolved).toBe(0);
    }
  });

  it("shows exactly which fine fractal structure the finite representation fills", () => {
    const all = fixtures();
    const selected = [all[0], all.find((f) => f.name === "TESSERACT 4D")!];
    const panels: { stats: PanelStats; lines: [string, string] }[] = [];
    const report: object[] = [];
    for (const [index, fixture] of selected.entries()) {
      const solid = finiteOpticalSolid(index === 0 ? 3 : 4);
      const R = Math.max(solid.radius, fixture.scene.boundingRadius);
      const floor = proceduralRear(R, true);
      const uniform = proceduralRear(R, false);
      const opaque = renderTransmission(
        fixture,
        0,
        false,
        SIZE,
        32,
        0.5,
        1200,
        {
          warp: false,
          terminalRadiance: floor,
        },
      );
      const sampled = renderTransmission(
        fixture,
        0.9,
        true,
        SIZE,
        64,
        0.5,
        1200,
        {
          strategy: "world",
          warp: false,
          terminalRadiance: floor,
        },
      );
      const finiteOpaque = renderFiniteTransmission(
        solid,
        fixture.scene,
        fixture.color,
        SIZE,
        0,
        0,
        floor,
      );
      const finiteSheets = renderFiniteTransmission(
        solid,
        fixture.scene,
        fixture.color,
        SIZE,
        0.9,
        0,
        floor,
      );
      const finiteBulk = renderFiniteTransmission(
        solid,
        fixture.scene,
        fixture.color,
        SIZE,
        0.9,
        0.8,
        floor,
      );
      const finiteUniform = renderFiniteTransmission(
        solid,
        fixture.scene,
        fixture.color,
        SIZE,
        0.9,
        0.8,
        uniform,
      );
      panels.push(
        { stats: opaque.stats, lines: [fixture.name, "PUBLIC OPAQUE"] },
        { stats: sampled.stats, lines: [fixture.name, "WORLD BANDS / FLOOR"] },
        { stats: finiteOpaque.stats, lines: [solid.name, "FINITE OPAQUE"] },
        {
          stats: finiteSheets.stats,
          lines: [solid.name, "EXACT RUNS / FLOOR"],
        },
        { stats: finiteBulk.stats, lines: [solid.name, "THICKNESS / FLOOR"] },
        {
          stats: finiteUniform.stats,
          lines: [solid.name, "THICKNESS / UNIFORM"],
        },
      );
      const { stats, ...finiteWork } = finiteBulk;
      const row = {
        fixture: fixture.name,
        size: SIZE,
        dimension: solid.dimension,
        finiteCells: solid.boxes.length,
        finiteCellSide: solid.boxes[0].half * 2,
        finiteFullRadius: solid.radius,
        publicFullRadius: fixture.scene.boundingRadius,
        angle: solid.angle,
        slice: solid.slice,
        publicHits: opaque.stats.hits,
        finiteHits: stats.hits,
        finiteWork,
        sampledWork: sampled.work,
        sampledUnresolved: sampled.unresolved,
        shapeChangeMeanByte: delta(opaque.stats, finiteOpaque.stats),
        absorptionMeanByte: delta(finiteSheets.stats, finiteBulk.stats),
        floorMeanByte: delta(finiteBulk.stats, finiteUniform.stats),
      };
      report.push(row);
      console.log(JSON.stringify(row));
      expect(finiteBulk.unresolved).toBe(0);
    }
    mkdirSync("scripts/out", { recursive: true });
    writeLabeledContactSheet(panels, 6, "transmission-finite-comparison.png");
    writeFileSync(
      "scripts/out/transmission-finite-report.json",
      JSON.stringify(report, null, 2),
    );
  });
});
