/**
 * Surface transmission research, NOT a production transport implementation.
 *
 * Run: npx vitest run --config scripts/vitest.harness.config.ts \
 *   scripts/finish-transmission.harness.ts --disableConsoleIntercept
 * TRANSMISSION_SIZE (default 192) retains the original comparison raster;
 * TRANSMISSION_WORLD_SIZE (default 64) controls the bounded world study.
 *
 * Every ray trace uses de-preview.ts. The legacy pixel prototype is retained
 * unchanged through renderTransmission's default arguments. The candidate
 * world rule is an explicitly sampled, hysteretic clearance band: R is the
 * fixture's full raw scene ball, entry is DE <= .002R, re-arm is an observed
 * DE > .003R, and the ray grid is .001R. These samples do not define signed
 * membership or exact material volume. Thin gaps may be missed and adjacent
 * runs falsely merged. Escape-family clearance is especially heuristic;
 * unlike the inverse-IFS estimator, it is not a certified geometric bound.
 *
 * One alpha event is composited per sampled run. Fresnel attenuation uses a
 * fixed .03R optical normal even though the visible shading normal remains
 * pixel-scale. The domain ends exactly at the existing scene-ball cap. That
 * means the sampled optical domain is complete, not that unknown geometry
 * outside the cap is a certified physical miss. Opaque hits, a named residual
 * bound (zero by default), and unresolved budget exits remain distinct.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { encodePng, writeLabeledContactSheet } from "./de-preview";
import type { PanelStats, Vec3 } from "./de-preview";
import {
  delta,
  fixtures,
  pair,
  renderTransmission,
  WORLD_BAND_DEFAULTS,
} from "./transmission-study";
import type {
  Fixture,
  TransmissionPanel,
  WorldBandSettings,
} from "./transmission-study";

const SIZE = Number(process.env.TRANSMISSION_SIZE ?? 192);
const WORLD_SIZE = Number(process.env.TRANSMISSION_WORLD_SIZE ?? 64);
const WORLD: Partial<WorldBandSettings> = {
  ...WORLD_BAND_DEFAULTS,
};

function withoutRich4d(): Fixture[] {
  return fixtures().filter((fixture) => fixture.name !== "16-CELL FLAKE 4D");
}

function world(
  fixture: Fixture,
  size: number,
  overrides: Partial<WorldBandSettings> = {},
  maxLayers = 32,
): TransmissionPanel {
  return renderTransmission(fixture, 0.9, true, size, maxLayers, 0.5, 1200, {
    strategy: "world",
    worldBand: { ...WORLD, ...overrides },
  });
}

function downsample2(stats: PanelStats): PanelStats {
  if (stats.width !== stats.height || stats.width % 2 !== 0)
    throw new Error("Transmission downsample expects an even square raster");
  const width = stats.width / 2;
  const rgb = new Uint8Array(width * width * 3);
  for (let y = 0; y < width; y++)
    for (let x = 0; x < width; x++)
      for (let channel = 0; channel < 3; channel++) {
        let sum = 0;
        for (let yy = 0; yy < 2; yy++)
          for (let xx = 0; xx < 2; xx++)
            sum +=
              (stats.rgb[
                ((2 * y + yy) * stats.width + 2 * x + xx) * 3 + channel
              ] /
                255) **
              2.2;
        rgb[(y * width + x) * 3 + channel] = Math.round(
          255 * (sum / 4) ** (1 / 2.2),
        );
      }
  return { ...stats, width, height: width, rgb };
}

function nearestSquare(stats: PanelStats, size: number): PanelStats {
  if (stats.width !== stats.height || size < stats.width)
    throw new Error("Contact-sheet enlargement requires a smaller square");
  const rgb = new Uint8Array(size * size * 3);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const source =
        (Math.floor((y * stats.height) / size) * stats.width +
          Math.floor((x * stats.width) / size)) *
        3;
      const target = (y * size + x) * 3;
      rgb[target] = stats.rgb[source];
      rgb[target + 1] = stats.rgb[source + 1];
      rgb[target + 2] = stats.rgb[source + 2];
    }
  return { ...stats, width: size, height: size, rgb };
}

function changedPixels(a: PanelStats, b: PanelStats, threshold = 2): number {
  if (a.rgb.length !== b.rgb.length)
    throw new Error("Matched rasters required");
  let changed = 0;
  for (let pixel = 0; pixel < a.width * a.height; pixel++) {
    const at = pixel * 3;
    if (
      Math.max(
        Math.abs(a.rgb[at] - b.rgb[at]),
        Math.abs(a.rgb[at + 1] - b.rgb[at + 1]),
        Math.abs(a.rgb[at + 2] - b.rgb[at + 2]),
      ) > threshold
    )
      changed++;
  }
  return changed;
}

function summary(
  fixture: Fixture,
  mode: string,
  size: number,
  result: TransmissionPanel,
): object {
  return {
    fixture: fixture.name,
    mode,
    size,
    sceneParameters: {
      boundingRadius: fixture.scene.boundingRadius,
      target: fixture.scene.target ?? [0, 0, 0],
      eye: fixture.scene.eye,
      eyeOffset: fixture.scene.eyeOffset,
      zoom: fixture.scene.zoom,
      stepScale: fixture.scene.stepScale,
    },
    hits: result.stats.hits,
    coverage: result.stats.hits / (size * size),
    ms: result.stats.ms,
    calls: result.calls,
    work: result.work,
    termination: result.termination,
    unresolved: result.unresolved,
    multiHit: result.multiHit,
    maxLayers: result.maxLayers,
    layerHits: result.layerHits,
    layerMeanThroughput: result.layerMeanThroughput,
    chunks: result.chunks,
    worldBand: result.worldBand,
  };
}

function matchedEventGrid(low: TransmissionPanel, high: TransmissionPanel) {
  if (high.stats.width !== low.stats.width * 2)
    throw new Error("Event-grid comparison requires a matched 2x raster");
  let centerChanges = 0;
  let blocksWithHighVariation = 0;
  let largestDifference = 0;
  for (let y = 0; y < low.stats.height; y++)
    for (let x = 0; x < low.stats.width; x++) {
      const lowCount = low.eventCounts[y * low.stats.width + x];
      const highCounts = [
        high.eventCounts[2 * y * high.stats.width + 2 * x],
        high.eventCounts[2 * y * high.stats.width + 2 * x + 1],
        high.eventCounts[(2 * y + 1) * high.stats.width + 2 * x],
        high.eventCounts[(2 * y + 1) * high.stats.width + 2 * x + 1],
      ];
      if (lowCount !== highCounts[3]) centerChanges++;
      if (Math.min(...highCounts) !== Math.max(...highCounts))
        blocksWithHighVariation++;
      largestDifference = Math.max(
        largestDifference,
        ...highCounts.map((value) => Math.abs(value - lowCount)),
      );
    }
  return {
    coarseVsHighCornerChanges: centerChanges,
    blocksWithHighVariation,
    largestDifference,
  };
}

describe("Surface transmission research", () => {
  it("reveals a genuinely hidden opaque object through an unsigned front object", () => {
    const oldWith = renderTransmission(pair(true), 0.9, false, 129);
    const oldWithout = renderTransmission(pair(false), 0.9, false, 129);
    const throughWith = renderTransmission(pair(true), 0.9, true, 129);
    const throughWithout = renderTransmission(pair(false), 0.9, true, 129);
    const at = (64 * 129 + 64) * 3;
    expect([...oldWith.stats.rgb.slice(at, at + 3)]).toEqual([
      ...oldWithout.stats.rgb.slice(at, at + 3),
    ]);
    expect(
      throughWith.stats.rgb[at] - throughWithout.stats.rgb[at],
    ).toBeGreaterThan(80);
    expect(throughWith.unresolved).toBe(0);
    expect(throughWithout.unresolved).toBe(0);
    writeLabeledContactSheet(
      [
        { stats: oldWith.stats, lines: ["CURRENT / REAR ON", "TRANSMIT 0.9"] },
        {
          stats: oldWithout.stats,
          lines: ["CURRENT / REAR OFF", "TRANSMIT 0.9"],
        },
        {
          stats: throughWith.stats,
          lines: ["LAYERS / REAR ON", "TRANSMIT 0.9"],
        },
        {
          stats: throughWithout.stats,
          lines: ["LAYERS / REAR OFF", "TRANSMIT 0.9"],
        },
      ],
      4,
      "transmission-control.png",
    );
  });

  it("reports unresolved continuations instead of painting an untraced background", () => {
    const capped = renderTransmission(pair(true), 1, true, 33, 1);
    expect(capped.unresolved).toBeGreaterThan(0);
    const plateau = pair(false);
    plateau.scene.de = (p) => Math.max(0, p[2] - 0.65);
    plateau.opaque = undefined;
    const exhausted = renderTransmission(plateau, 1, true, 33, 4, 0.5, 2);
    expect(exhausted.unresolved).toBeGreaterThan(0);
  });

  it("keeps the original current/layered controls and reports old convergence", () => {
    const panels: { stats: PanelStats; lines: [string, string] }[] = [];
    const report: object[] = [];
    for (const fixture of withoutRich4d()) {
      for (const mode of [
        { label: "OPAQUE", t: 0, layers: false },
        { label: "CURRENT 0.35", t: 0.35, layers: false },
        { label: "CURRENT 0.90", t: 0.9, layers: false },
        { label: "LAYERS 0.90", t: 0.9, layers: true },
      ]) {
        const result = renderTransmission(fixture, mode.t, mode.layers, SIZE);
        report.push(summary(fixture, mode.label, SIZE, result));
        panels.push({ stats: result.stats, lines: [fixture.name, mode.label] });
        if (!mode.layers && mode.t === 0.9) {
          panels.push({
            stats: result.linearFade,
            lines: [fixture.name, "LINEAR FADE 0.90"],
          });
          report.push({
            fixture: fixture.name,
            linearFadeDelta: delta(result.stats, result.linearFade),
          });
        }
        if (mode.layers) {
          panels.push({
            stats: result.warped,
            lines: [fixture.name, "LAYERS + SLAB WARP"],
          });
          report.push({
            fixture: fixture.name,
            warpDelta: delta(result.stats, result.warped),
            warpCalls: result.warpCalls,
            warpFallbacks: result.warpFallbacks,
          });
        }
      }
      const coarse = renderTransmission(fixture, 0.9, true, 80, 32, 0.5);
      const fine = renderTransmission(fixture, 0.9, true, 80, 64, 0.25, 2400);
      const short = renderTransmission(fixture, 0.9, true, 80, 8, 0.5);
      report.push({
        fixture: fixture.name,
        convergenceSize: 80,
        halfScanDelta: delta(coarse.stats, fine.stats),
        eightLayerDelta: delta(short.stats, coarse.stats),
        unresolved32: coarse.unresolved,
        unresolved64: fine.unresolved,
        unresolved8: short.unresolved,
      });
      expect(fine.unresolved).toBe(0);
    }
    const path = writeLabeledContactSheet(
      panels,
      6,
      "transmission-comparison.png",
    );
    mkdirSync("scripts/out", { recursive: true });
    writeFileSync(
      "scripts/out/transmission-report.json",
      JSON.stringify(report, null, 2),
    );
    panels.forEach((panel, i) =>
      writeFileSync(
        `scripts/out/transmission-${i}.png`,
        encodePng(panel.stats.width, panel.stats.height, panel.stats.rgb),
      ),
    );
    console.log(path);
  });

  it("makes world events independent of odd raster size and work chunks", () => {
    const eventRows: object[] = [];
    const centerThroughputs: number[] = [];
    for (const size of [63, 95]) {
      for (const scanPhase of [0, 0.5]) {
        const result = world(pair(true), size, { scanPhase, chunkSteps: 37 });
        const frontOnly = world(pair(false), size, {
          scanPhase,
          chunkSteps: 37,
        });
        const center = Math.floor(size / 2) * size + Math.floor(size / 2);
        expect(result.eventCounts[center]).toBe(2);
        expect(result.finalThroughput[center]).toBe(0);
        expect(frontOnly.eventCounts[center]).toBe(1);
        expect(frontOnly.finalThroughput[center]).toBeCloseTo(0.864, 10);
        centerThroughputs.push(frontOnly.finalThroughput[center]);
        expect(result.termination.opaque).toBeGreaterThan(0);
        expect(result.unresolved).toBe(0);
        eventRows.push({
          size,
          centerEvents: result.eventCounts[center],
          centerThroughput: result.finalThroughput[center],
          frontOnlyThroughput: frontOnly.finalThroughput[center],
          scanPhase,
          chunks: result.chunks,
        });
      }
    }
    expect(
      Math.max(...centerThroughputs) - Math.min(...centerThroughputs),
    ).toBeLessThan(1e-12);
    const chunkRows: object[] = [];
    const escape4 = fixtures().find(
      (fixture) => fixture.name === "MANDELBOX 4D",
    )!;
    for (const fixture of [pair(true), escape4]) {
      const results = [1, 7, 1200].map((chunkSteps) => ({
        chunkSteps,
        result: world(fixture, 9, { chunkSteps }, 64),
      }));
      const reference = results[2].result;
      for (const { chunkSteps, result } of results) {
        expect(result.eventCounts).toEqual(reference.eventCounts);
        expect(result.finalThroughput).toEqual(reference.finalThroughput);
        expect(result.termination).toEqual(reference.termination);
        // Only the preview's pixel normal/shading may see iterative-t rounding.
        expect(delta(result.stats, reference.stats)).toBeLessThan(0.05);
        chunkRows.push({
          fixture: fixture.name,
          chunkSteps,
          chunks: result.chunks,
          eventArrayExact: true,
          throughputArrayExact: true,
          displayDelta: delta(result.stats, reference.stats),
          termination: result.termination,
        });
      }
    }
    console.log(JSON.stringify({ worldEventRows: eventRows, chunkRows }));
  });

  it("renders the world-band matrix, scale controls and a short posed 4D strip", () => {
    mkdirSync("scripts/out", { recursive: true });
    const panels: { stats: PanelStats; lines: [string, string] }[] = [];
    const report: object[] = [];
    for (const fixture of fixtures()) {
      const pixel = renderTransmission(
        fixture,
        0.9,
        true,
        WORLD_SIZE,
        32,
        0.5,
        1200,
        { warp: false },
      );
      const capped32 = world(fixture, WORLD_SIZE, {}, 32);
      const fixed = world(fixture, WORLD_SIZE, {}, 64);
      panels.push(
        { stats: pixel.stats, lines: [fixture.name, "PIXEL BANDS"] },
        { stats: fixed.stats, lines: [fixture.name, "WORLD BANDS"] },
        { stats: fixed.warped, lines: [fixture.name, "WORLD + SLAB WARP"] },
      );
      const row = {
        ...summary(fixture, "WORLD BANDS", WORLD_SIZE, fixed),
        pixelWorldDelta: delta(pixel.stats, fixed.stats),
        pixelMaxLayers: pixel.maxLayers,
        unresolvedAt32: capped32.unresolved,
        maxLayersAt32: capped32.maxLayers,
        warpDelta: delta(fixed.stats, fixed.warped),
        warpCalls: fixed.warpCalls,
        warpFallbacks: fixed.warpFallbacks,
      };
      report.push(row);
      const slug = fixture.name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-");
      writeFileSync(
        `scripts/out/transmission-world-${slug}-straight.png`,
        encodePng(fixed.stats.width, fixed.stats.height, fixed.stats.rgb),
      );
      writeFileSync(
        `scripts/out/transmission-world-${slug}-warped.png`,
        encodePng(fixed.warped.width, fixed.warped.height, fixed.warped.rgb),
      );
      console.log(JSON.stringify(row));
    }

    const menger = fixtures().find((fixture) => fixture.name === "MENGER 3D")!;
    const low = world(menger, 48, {}, 64);
    const high = world(menger, 96, {}, 64);
    const highDownsampled = downsample2(high.stats);
    const phase = world(menger, 48, { scanPhase: 0.5 }, 64);
    const normal02 = world(menger, 48, { opticalNormalFraction: 0.02 }, 64);
    const normal04 = world(menger, 48, { opticalNormalFraction: 0.04 }, 64);
    const zoomedFixture: Fixture = {
      ...menger,
      name: "MENGER 3D ZOOM",
      scene: { ...menger.scene, zoom: 0.27 },
    };
    const zoomed = world(zoomedFixture, 48, {}, 64);
    panels.push(
      { stats: low.stats, lines: ["MENGER 48", "WORLD NATIVE"] },
      { stats: highDownsampled, lines: ["MENGER 96 > 48", "2X DOWNSAMPLE"] },
      { stats: phase.stats, lines: ["MENGER 48", "GRID PHASE 0.5"] },
      { stats: normal02.stats, lines: ["MENGER 48", "NORMAL 0.02R"] },
      { stats: normal04.stats, lines: ["MENGER 48", "NORMAL 0.04R"] },
      { stats: zoomed.stats, lines: ["MENGER ZOOM .27", "WORLD BANDS"] },
    );
    report.push({
      fixture: menger.name,
      matchedResolution: {
        low: 48,
        high: 96,
        downsampleDelta: delta(low.stats, highDownsampled),
        changedPixels: changedPixels(low.stats, highDownsampled),
        eventGrid: matchedEventGrid(low, high),
      },
      scanPhase: {
        fraction: 0.5,
        delta: delta(low.stats, phase.stats),
        changedPixels: changedPixels(low.stats, phase.stats),
        eventCountChanges: low.eventCounts.reduce(
          (count, value, i) => count + Number(value !== phase.eventCounts[i]),
          0,
        ),
      },
      opticalNormal: {
        fractions: [0.02, 0.04],
        delta: delta(normal02.stats, normal04.stats),
        changedPixels: changedPixels(normal02.stats, normal04.stats),
      },
      zoom: { from: 0.36, to: 0.27 },
    });

    const poses = [
      { angle: 0.27, w0: 0.18, eyeOffset: [0.5, 0.3, 2.25] as Vec3 },
      { angle: 0.35, w0: 0.3, eyeOffset: [0.55, 0.35, 2.2] as Vec3 },
      { angle: 0.46, w0: 0.42, eyeOffset: [0.62, 0.4, 2.15] as Vec3 },
    ];
    const motion: {
      file: string;
      warpedFile: string;
      parameters: (typeof poses)[number];
    }[] = [];
    poses.forEach((parameters, frame) => {
      const fixture = fixtures({ ...parameters, zoom: 0.22 }).find(
        (candidate) => candidate.name === "MANDELBOX 4D",
      )!;
      const result = world(fixture, 48, {}, 64);
      const file = `transmission-motion-${frame}.png`;
      const warpedFile = `transmission-motion-${frame}-warped.png`;
      writeFileSync(
        `scripts/out/${file}`,
        encodePng(result.stats.width, result.stats.height, result.stats.rgb),
      );
      writeFileSync(
        `scripts/out/${warpedFile}`,
        encodePng(result.warped.width, result.warped.height, result.warped.rgb),
      );
      motion.push({ file, warpedFile, parameters });
      panels.push(
        {
          stats: result.stats,
          lines: ["MANDELBOX 4D CLOSE", `POSE ${frame}`],
        },
        {
          stats: result.warped,
          lines: ["MANDELBOX 4D CLOSE", `POSE ${frame} + WARP`],
        },
      );
      report.push({
        ...summary(fixture, `POSE ${frame}`, result.stats.width, result),
        warpDelta: delta(result.stats, result.warped),
        warpCalls: result.warpCalls,
        warpFallbacks: result.warpFallbacks,
      });
    });
    const exact = JSON.stringify(
      { model: WORLD, opticalDomain: "existing full raw scene ball R", motion },
      null,
      2,
    );
    const html = `<!doctype html><meta charset="utf-8"><title>Transmission motion strip</title><style>body{background:#111;color:#ddd;font:14px system-ui}main{display:grid;grid-template-columns:repeat(3,auto);gap:12px}img{width:256px}pre{white-space:pre-wrap}</style><main>${motion.map(({ file, warpedFile }, frame) => `<figure><img src="${file}"><figcaption>frame ${frame} straight</figcaption><img src="${warpedFile}"><figcaption>frame ${frame} warped</figcaption></figure>`).join("")}</main><pre>${exact}</pre>`;
    writeFileSync("scripts/out/transmission-motion.html", html);
    writeFileSync(
      "scripts/out/transmission-world-report.json",
      JSON.stringify(report, null, 2),
    );
    console.log(
      writeLabeledContactSheet(
        panels.map(({ stats, lines }) => ({
          stats: nearestSquare(stats, 192),
          lines,
        })),
        4,
        "transmission-world-comparison.png",
      ),
    );
  });
});
